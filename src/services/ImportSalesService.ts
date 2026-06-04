import { Op } from 'sequelize';
import { sequelize } from '../config/database';
import { Batch, Store, Marketplace, Sale } from '../models/index';

export interface SaleRow {
  nf: string;
  data: string; // formato "DD/MM/YYYY"
  baseIcms: number;
  loja: string;
}

export interface ImportSalesPayload {
  rows: SaleRow[];
  storeMapping: Record<string, string>;
}

export class ImportSalesService {

  async execute(payload: any) {
    const { rows, storeMapping } = payload;

    // 1. Criamos o Lote (Batch) pai e garantimos as lojas em uma transação inicial rápida
    const initialTransaction = await sequelize.transaction();
    let batch: any;

    try {
      batch = await Batch.create({
        name: `Lote Importado em ${new Date().toLocaleDateString('pt-BR')}`,
      }, { transaction: initialTransaction });

      // Garante que as Lojas existam e estejam vinculadas aos seus Marketplaces
      for (const [storeId, marketplaceId] of Object.entries(storeMapping)) {
        const storeExists = await Store.findByPk(storeId, { transaction: initialTransaction });

        if (!storeExists) {
          const formattedMarketplaceId = (marketplaceId as string).toLowerCase().trim();
          const marketplaceExists = await Marketplace.findByPk(formattedMarketplaceId, { transaction: initialTransaction });

          if (!marketplaceExists) {
            throw new Error(`Marketplace '${marketplaceId}' não encontrado. Cadastre-o primeiro.`);
          }

          await Store.create({
            id: storeId,
            name: storeId,
            marketplaceId: formattedMarketplaceId
          }, { transaction: initialTransaction });
        }
      }

      // Confirma a criação do lote e das lojas parceiras
      await initialTransaction.commit();
    } catch (error) {
      await initialTransaction.rollback();
      throw error;
    }

    // Arrays para separar o que está correto do que tem problemas
    const validSalesToInsert: any[] = [];
    const duplicatedRowsReport: any[] = [];
    const missingInfoRowsReport: any[] = [];

    // Pegamos todas as NFs enviadas na planilha para fazer uma única busca otimizada no banco
    const allNfs = rows.map((r: any) => String(r.nf).trim()).filter(Boolean);

    // Busca quais dessas NFs já existem cadastradas no sistema (Sem travar transação longa)
    const existingSales = await Sale.findAll({
      where: {
        nf: {
          [Op.in]: allNfs
        }
      },
      attributes: ['nf'],
      raw: true
    });

    const existingNfSet = new Set(existingSales.map((s: any) => String(s.nf).trim()));
    const trackingInThisImportSet = new Set<string>();

    // 2. Validação linha por linha da planilha em memória (Extremamente rápido)
    for (const row of rows) {
      const currentNf = String(row.nf || '').trim();
      const currentLoja = String(row.loja || '').trim();

      // VALIDAÇÃO A: Faltando informações cruciais
      if (!currentNf || currentNf === 'S/N' || !row.data || row.data === 'S/D' || !currentLoja || currentLoja === 'Não Informada') {
        missingInfoRowsReport.push({
          nf: currentNf || 'Não informada',
          data: row.data || 'Não informada',
          loja: currentLoja || 'Não informada',
          motivo: 'Falta NF, Data ou Identificador da Loja'
        });
        continue;
      }

      // VALIDAÇÃO B: Duplicidade (Já existe no banco ou está repetido na própria planilha)
      if (existingNfSet.has(currentNf) || trackingInThisImportSet.has(currentNf)) {
        duplicatedRowsReport.push({
          nf: currentNf,
          data: row.data,
          loja: currentLoja,
          motivo: existingNfSet.has(currentNf) ? 'Esta Nota Fiscal já foi importada anteriormente' : 'Nota Fiscal duplicada dentro da própria planilha'
        });
        continue;
      }

      // Se passou nas validações, processa a data para o banco
      const parts = row.data.split('/');
      if (parts.length !== 3) {
        missingInfoRowsReport.push({
          nf: currentNf,
          data: row.data,
          loja: currentLoja,
          motivo: 'Formato de data inválido (Use DD/MM/AAAA)'
        });
        continue;
      }

      const day = String(parts[0]).padStart(2, '0');
      const month = String(parts[1]).padStart(2, '0');
      let year = parts[2];
      if (year.length === 2) year = `20${year}`;

      const dbDateString = `${year}-${month}-${day}`;

      // Adiciona ao lote de inserção e ao controle de duplicidade temporário
      trackingInThisImportSet.add(currentNf);
      validSalesToInsert.push({
        nf: currentNf,
        date: dbDateString,
        baseIcms: Number(row.baseIcms) || 0,
        storeId: currentLoja,
        batchId: batch.id
      });
    }

    // 3. SALVAMENTO EM CHUNKS (Fatiamento de Aço para evitar estouro do Postgres)
    const CHUNK_SIZE = 2000; // Grava de 2k em 2k, ideal para performance e segurança
    const totalSalesToSave = validSalesToInsert.length;

    if (totalSalesToSave > 0) {
      console.log(`📦 Iniciando gravação de ${totalSalesToSave} vendas em blocos de ${CHUNK_SIZE}...`);

      for (let i = 0; i < totalSalesToSave; i += CHUNK_SIZE) {
        const chunk = validSalesToInsert.slice(i, i + CHUNK_SIZE);

        // Abre uma mini-transação isolada para este bloco
        const chunkTransaction = await sequelize.transaction();

        try {
          await Sale.bulkCreate(chunk, { transaction: chunkTransaction });
          await chunkTransaction.commit(); // Salva permanentemente esse pedaço
        } catch (chunkError) {
          await chunkTransaction.rollback();
          console.error(`❌ Falha crítica ao salvar o bloco que inicia no índice ${i}. Tentando desfazer lote pai...`);

          // Fallback de segurança: Se a gravação falhar, remove o lote pai para evitar dados órfãos
          try {
            await Batch.destroy({ where: { id: batch.id } });
          } catch (delErr) {
            console.error("Não foi possível limpar o lote pai após falha de inserção:", delErr);
          }

          throw new Error('Erro de persistência em lote no banco de dados. Operação cancelada.');
        }
      }
      console.log(`✅ Todos os blocos gravados no PostgreSQL com sucesso!`);
    }

    // Retorno rico em detalhes para o frontend mapear no relatório/PDF
    return {
      message: 'Processamento do lote concluído!',
      batchId: batch.id,
      salesImported: totalSalesToSave,
      duplicatedCount: duplicatedRowsReport.length,
      missingInfoCount: missingInfoRowsReport.length,
      duplicatedRows: duplicatedRowsReport,
      missingRows: missingInfoRowsReport
    };
  }

  // Novo método para listar os lotes cadastrados com paginação opcional
  async listBatches(page: number = 1, limit: number = 10) {
    const offset = (page - 1) * limit;

    const { rows, count } = await Batch.findAndCountAll({
      attributes: [
        'id',
        'name',
        'createdAt',
        'updatedAt',
        [
          sequelize.literal(`(
            SELECT COUNT(*) 
            FROM "${Sale.tableName}" AS "sales" 
            WHERE "sales"."batchId" = "${Batch.name}"."id"
          )`),
          'salesCount'
        ],
        [
          sequelize.literal(`(
            SELECT COALESCE(SUM("sales"."baseIcms"), 0) 
            FROM "${Sale.tableName}" AS "sales" 
            WHERE "sales"."batchId" = "${Batch.name}"."id"
          )`),
          'totalBaseIcms'
        ]
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });

    return {
      data: rows,
      meta: {
        totalRecords: count,
        totalPages: Math.ceil(count / limit),
        currentPage: page,
        pageSize: limit
      }
    };
  }

  // Confere o Lote: Retorna o lote com todas as suas respectivas vendas
  async getBatchDetails(batchId: string) {
    console.log(`[ImportSalesService] [getBatchDetails] 🔍 Executando busca no banco para o lote: ${batchId}`);

    const batch = await Batch.findByPk(batchId, {
      include: [
        {
          model: Sale,
          as: 'sales', // Certifique-se de que no seu Model 'Batch' a relação hasMany com 'Sale' use exatamente as: 'sales'
          required: false,
          include: [
            {
              model: Store,
              as: 'store', // Certifique-se de que no seu Model 'Sale' a relação belongsTo com 'Store' use exatamente as: 'store'
              required: false
            }
          ]
        }
      ]
    });

    if (!batch) {
      console.error(`[ImportSalesService] [getBatchDetails] ❌ Lote ${batchId} não foi encontrado no banco.`);
      throw new Error('Lote de importação não encontrado.');
    }

    // Retorna o objeto puro do Sequelize mapeado
    return batch;
  }

  // Deleta o Lote: Graças ao `{ onDelete: 'CASCADE' }` nos models, limpa as vendas juntas
  async deleteBatch(batchId: string) {
    const batch = await Batch.findByPk(batchId);

    if (!batch) {
      throw new Error('Lote de importação não encontrado.');
    }

    await batch.destroy();
    return { message: 'Lote e todas as suas vendas associadas foram removidos.' };
  }
}