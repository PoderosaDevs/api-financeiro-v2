import { Op } from 'sequelize';
import { sequelize } from '../config/database';
import { Batch, Sale } from '../models/index';
import { SaleStatusResolver } from './SaleStatusResolver';
import _ from 'lodash';
import { Devolution } from '../models/Devolution';

interface DevolutionRow {
    nf: string;
    idDevolucao: string;
    baseIcms: number;
    valor: number;
    motivoDevolucao: string;
    tratativa?: string;
}

export interface ImportDevolutionsPayload {
    rows: DevolutionRow[];
}

export class ImportDevolutionsService {

    async execute(payload: ImportDevolutionsPayload) {
        const { rows } = payload;

        console.log(`🚀 [INÍCIO] Processo iniciado com ${rows?.length || 0} linhas.`);

        if (!rows || rows.length === 0) {
            throw new Error('O arquivo de devolução importado está vazio.');
        }

        console.time('⏳ Tempo total de Importação');

        // ============================================================================
        // FASE 1: BUSCA DE VENDAS E HISTÓRICO
        // ============================================================================
        const allNfs = [...new Set(rows.map(r => String(r.nf || '').trim()).filter(Boolean))];

        const existingSales = await Sale.findAll({
            where: { nf: { [Op.in]: allNfs } },
            attributes: ['id', 'nf', 'baseIcms'],
            raw: true
        });

        const salesMap = new Map<string, { id: string; baseIcms: number }>();
        existingSales.forEach((s: any) => {
            salesMap.set(String(s.nf).trim(), {
                id: s.id,
                baseIcms: Number(s.baseIcms || 0)
            });
        });

        const historicalDevolutions = await Devolution.findAll({
            where: { nf: { [Op.in]: allNfs } },
            attributes: ['nf', 'idDevolucao', 'valor'],
            raw: true
        });

        const historyMap = _.groupBy(historicalDevolutions, (d: any) => String(d.nf).trim());

        // ============================================================================
        // FASE 2: VALIDAÇÃO EM MEMÓRIA
        // ============================================================================
        const validDevolutionsToInsert: any[] = [];
        const duplicatedRowsReport: any[] = [];
        const missingInfoRowsReport: any[] = [];
        const currentFileTracking = new Map<string, string[]>();
        const affectedSaleIds = new Set<string>();

        let idx = 0;
        for (const row of rows) {
            idx++;
            const currentNf = String(row.nf || '').trim();
            const currentIdDevolucao = String(row.idDevolucao || '').trim();
            const currentValor = Number(row.valor || 0);
            const currentBase = Number(row.baseIcms || 0);

            if (!currentNf || currentNf === 'S/N' || !currentIdDevolucao || currentValor <= 0) {
                missingInfoRowsReport.push({
                    nf: currentNf || 'Não informada',
                    loja: 'Não aplicável',
                    motivo: 'Dados corrompidos ou valor menor/igual a zero.'
                });
                continue;
            }

            const saleData = salesMap.get(currentNf);
            if (!saleData) {
                missingInfoRowsReport.push({
                    nf: currentNf,
                    loja: 'Não localizada',
                    motivo: 'Nota Fiscal da venda original não encontrada no sistema.'
                });
                continue;
            }

            const history = historyMap[currentNf] || [];
            const alreadyUploadedInCurrentFile = currentFileTracking.get(currentNf) || [];

            const existsInDb = history.some((d: any) => String(d.idDevolucao).trim() === currentIdDevolucao);
            const existsInCurrentFile = alreadyUploadedInCurrentFile.includes(currentIdDevolucao);

            if (existsInDb || existsInCurrentFile) {
                duplicatedRowsReport.push({
                    nf: currentNf,
                    loja: 'Identificada via Sale',
                    motivo: existsInDb ? 'O identificador já está registrado no banco.' : 'Identificador repetido na mesma planilha.'
                });
                continue;
            }

            const somaValorHistorico = history.reduce((sum: number, d: any) => sum + Number(d.valor || 0), 0);
            const somaValorArquivoAtual = validDevolutionsToInsert.filter(d => d.nf === currentNf).reduce((sum, d) => sum + d.valor, 0);
            const acumuladoTotal = Number((somaValorHistorico + somaValorArquivoAtual + currentValor).toFixed(2));

            if (acumuladoTotal > (saleData.baseIcms + 0.10)) {
                missingInfoRowsReport.push({
                    nf: currentNf,
                    loja: 'Identificada via Sale',
                    motivo: `Estouro financeiro: O acumulado (R$ ${acumuladoTotal.toFixed(2)}) excede a base de ICMS da venda original (R$ ${saleData.baseIcms})`
                });
                continue;
            }

            alreadyUploadedInCurrentFile.push(currentIdDevolucao);
            currentFileTracking.set(currentNf, alreadyUploadedInCurrentFile);
            affectedSaleIds.add(saleData.id);

            validDevolutionsToInsert.push({
                nf: currentNf,
                idDevolucao: currentIdDevolucao,
                baseIcms: currentBase,
                valor: currentValor,
                motivoDevolucao: String(row.motivoDevolucao || 'NÃO INFORMADO').toUpperCase(),
                tratativa: row.tratativa ? String(row.tratativa).toUpperCase() : null,
                saleId: saleData.id
            });
        }

        // ============================================================================
        // FASE 3: PERSISTÊNCIA E ATUALIZAÇÃO DE STATUS
        // ============================================================================
        let batchId: string | null = null;
        const totalDevolutionsToSave = validDevolutionsToInsert.length;

        if (totalDevolutionsToSave > 0) {
            const totalValorCalculado = validDevolutionsToInsert.reduce((sum, d) => sum + d.valor, 0);
            const mainTransaction = await sequelize.transaction();

            try {
                // 1. Cria o Lote (Batch)
                const batch = await Batch.create({
                    name: `Lote de Devolução Importado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}`,
                    type: 'DEVOLUTIONS',
                    salesCount: totalDevolutionsToSave,
                    totalBaseIcms: Number(totalValorCalculado.toFixed(2))
                }, { transaction: mainTransaction });

                batchId = batch.id;
                validDevolutionsToInsert.forEach(d => d.batchId = batchId);

                // 2. Salva os registros em massa (Chunks)
                const chunks = _.chunk(validDevolutionsToInsert, 2000);
                for (const chunk of chunks) {
                    await Devolution.bulkCreate(chunk, { transaction: mainTransaction });
                }

                // 3. ATUALIZAÇÃO DE STATUS (Dentro da Transação)
                // Passando a transação para o resolver recalcular baseado nas devoluções inseridas
                await SaleStatusResolver.syncStatusForSales(Array.from(affectedSaleIds), mainTransaction);

                // 4. Commit de tudo se nada falhar
                await mainTransaction.commit();
                console.log(`✅ Sucesso! Devoluções salvas e status atualizados no Lote ${batchId}.`);
            } catch (error) {
                // Qualquer erro faz o rollback completo e seguro
                await mainTransaction.rollback();
                console.error("❌ Erro crítico na importação de devoluções (Operação revertida):", error);
                throw new Error('Erro crítico ao salvar as devoluções ou atualizar os status. Operação revertida.');
            }
        }

        console.timeEnd('⏳ Tempo total de Importação');

        return {
            message: totalDevolutionsToSave > 0 ? 'Auditoria e Importação de devoluções concluídas!' : 'Nenhuma devolução válida para importar.',
            batchId: batchId || 'Nenhum lote gerado',
            salesImported: totalDevolutionsToSave,
            duplicatedCount: duplicatedRowsReport.length,
            missingInfoCount: missingInfoRowsReport.length,
            duplicatedRows: duplicatedRowsReport,
            missingRows: missingInfoRowsReport
        };
    }

    async listBatches(page: number = 1, limit: number = 10) {
        const offset = (page - 1) * limit;
        const { rows, count } = await Batch.findAndCountAll({
            where: { type: 'DEVOLUTIONS' },
            attributes: [
                'id', 'name', 'createdAt', 'updatedAt',
                [
                    sequelize.literal(`(SELECT COUNT(*)::int FROM "${Devolution.tableName}" AS "devolutions" WHERE "devolutions"."batch_id" = "${Batch.tableName}"."id")`),
                    'salesCount'
                ],
                [
                    sequelize.literal(`(SELECT COALESCE(SUM("devolutions"."valor"), 0)::float FROM "${Devolution.tableName}" AS "devolutions" WHERE "devolutions"."batch_id" = "${Batch.tableName}"."id")`),
                    'totalBaseIcms'
                ]
            ],
            order: [['createdAt', 'DESC']],
            limit, offset
        });

        return { data: rows, meta: { totalRecords: count, totalPages: Math.ceil(count / limit), currentPage: page, pageSize: limit } };
    }

    async getBatchDetails(batchId: string) {
        const batch = await Batch.findOne({
            where: { id: batchId, type: 'DEVOLUTIONS' },
            include: [{
                model: Devolution, as: 'devolutions', required: false,
                include: [
                    { model: Sale, as: 'sale', required: false }
                ]
            }]
        });

        if (!batch) throw new Error('Lote de devolução não encontrado.');
        return batch;
    }

    async deleteBatch(batchId: string) {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!batchId || batchId === 'null' || !uuidRegex.test(batchId)) {
            throw new Error('O ID do lote fornecido é inválido.');
        }

        const batch = await Batch.findOne({ where: { id: batchId, type: 'DEVOLUTIONS' } });
        if (!batch) throw new Error('Lote de devolução não encontrado.');

        const targetDevolutions = await Devolution.findAll({
            where: { batchId },
            attributes: ['saleId', 'nf'],
            raw: true
        });

        if (targetDevolutions.length === 0) {
            await batch.destroy();
            return { message: 'O lote de devoluções estava vazio e foi removido com sucesso.', salesAffected: 0 };
        }

        const uniqueSaleIds = [...new Set(targetDevolutions.map((d: any) => d.saleId))];

        const deleteTransaction = await sequelize.transaction();
        try {
            await Devolution.destroy({ where: { batchId }, transaction: deleteTransaction });
            await Batch.destroy({ where: { id: batchId }, transaction: deleteTransaction });
            await SaleStatusResolver.syncStatusForSales(uniqueSaleIds, deleteTransaction);

            await deleteTransaction.commit();

            return {
                message: 'Lote de devolução removido com sucesso e os status das vendas afetadas foram atualizados.',
                salesAffected: uniqueSaleIds.length
            };
        } catch (error) {
            await deleteTransaction.rollback();
            throw new Error(`Falha ao excluir o lote de devolução: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
        }
    }
}