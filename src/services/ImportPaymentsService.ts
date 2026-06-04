import { Op } from 'sequelize';
import { sequelize } from '../config/database';
import { Batch, Store, Sale, Payment } from '../models/index';
import { SaleStatusResolver } from './SaleStatusResolver';
import _ from 'lodash';

// ============================================================================
// ⚠️ MAPEAMENTO PROVISÓRIO DE EQUIVALÊNCIA DE LOJAS
// Remover ou limpar quando os nomes das planilhas forem padronizados.
// ============================================================================
const LOJA_ALIAS_MAP: Record<string, string> = {
    'MAGALU - BP': 'Magazine Luiza - BP',
    'MAGALU': 'Magazine Luiza - BP',
};

export interface PaymentRow {
    nf: string;
    parcelaPaga: number;
    parcelas: number;
    baseIcms: number;
    repasse: number;
    comissaoVenda: number;
    comissaoFrete: number;
    fretesTaxas: number;
    loja: string;
}

export interface ImportPaymentsPayload {
    rows: PaymentRow[];
}

export class ImportPaymentsService {

    async execute(payload: ImportPaymentsPayload) {
        const { rows } = payload;

        if (!rows || rows.length === 0) {
            throw new Error('O arquivo importado está vazio.');
        }

        console.time('⏳ Tempo total de Importação');

        // ============================================================================
        // NORMALIZAÇÃO EM TEMPO DE EXECUÇÃO (PROVISÓRIO)
        // Traduz os nomes alternativos para o nome oficial que já está no banco
        // ============================================================================
        const normalizedRows = rows.map(row => {
            const rawLoja = String(row.loja || '').trim();
            const normalizedLoja = LOJA_ALIAS_MAP[rawLoja] || rawLoja;

            return {
                ...row,
                loja: normalizedLoja
            };
        });

        // ============================================================================
        // FASE 1: PRE-FLIGHT (Coleta de Dados em Massa para a Memória RAM)
        // ============================================================================
        const allNfs = [...new Set(normalizedRows.map(r => String(r.nf || '').trim()).filter(Boolean))];
        const allLojas = [...new Set(normalizedRows.map(r => String(r.loja || '').trim()).filter(Boolean))];

        // 1.1 - Sincronização Massiva de Lojas
        const existingStores = await Store.findAll({
            where: { id: { [Op.in]: allLojas } },
            attributes: ['id'],
            raw: true
        });
        const existingStoreIds = new Set(existingStores.map(s => s.id));
        const storesToCreate = allLojas
            .filter(id => !existingStoreIds.has(id))
            .map(id => ({ id, name: id, marketplaceId: 'mercadolivre' })); // Ajustado de 'generic' para evitar erro de FK

        if (storesToCreate.length > 0) {
            await Store.bulkCreate(storesToCreate, { ignoreDuplicates: true });
        }

        // 1.2 - Busca de Vendas e Histórico de uma só vez
        const existingSales = await Sale.findAll({
            where: { nf: { [Op.in]: allNfs } },
            attributes: ['id', 'nf', 'baseIcms'],
            raw: true
        });

        const salesMap = new Map<string, { id: string; baseIcms: number }>();
        existingSales.forEach((s: any) => salesMap.set(String(s.nf).trim(), { id: s.id, baseIcms: Number(s.baseIcms) }));

        const historicalPayments = await Payment.findAll({
            where: { nf: { [Op.in]: allNfs } },
            attributes: ['nf', 'parcelaPaga', 'parcelas', 'baseIcms', 'storeId'],
            raw: true
        });

        const historyMap = _.groupBy(historicalPayments, (p: any) => String(p.nf).trim());

        // ============================================================================
        // FASE 2: VALIDAÇÃO EM MEMÓRIA (Processamento 100% Síncrono e CPU-Bound)
        // ============================================================================
        const validPaymentsToInsert: any[] = [];
        const duplicatedRowsReport: any[] = [];
        const missingInfoRowsReport: any[] = [];
        const currentFileTracking = new Map<string, number[]>();
        const affectedSaleIds = new Set<string>();

        for (const row of normalizedRows) {
            const currentNf = String(row.nf || '').trim();
            const currentLoja = String(row.loja || '').trim();
            const pPaga = Number(row.parcelaPaga);
            const pTotal = Number(row.parcelas);

            // Validação de Integridade Básica
            if (!currentNf || currentNf === 'S/N' || !currentLoja || !pPaga || !pTotal || pPaga > pTotal) {
                missingInfoRowsReport.push({
                    nf: currentNf || 'Não informada', data: `Parcela: ${pPaga || '?'}/${pTotal || '?'}`, loja: currentLoja || 'Não informada',
                    motivo: 'Dados corrompidos ou Parcela Paga maior do que o Total de Parcelas'
                });
                continue;
            }

            // Existência da Venda
            const saleData = salesMap.get(currentNf);
            if (!saleData) {
                missingInfoRowsReport.push({
                    nf: currentNf, data: `Parcela: ${pPaga}/${pTotal}`, loja: currentLoja,
                    motivo: 'Nota Fiscal de venda não encontrada no sistema'
                });
                continue;
            }

            const history = historyMap[currentNf] || [];
            const alreadyUploadedInCurrentFile = currentFileTracking.get(currentNf) || [];

            // Regra: Duplicidade
            const existsInDb = history.some((p: any) => Number(p.parcelaPaga) === pPaga && p.storeId === currentLoja);
            const existsInCurrentFile = alreadyUploadedInCurrentFile.includes(pPaga);

            if (existsInDb || existsInCurrentFile) {
                duplicatedRowsReport.push({
                    nf: currentNf, data: `Parcela ${pPaga}/${pTotal}`, loja: currentLoja,
                    motivo: existsInDb ? `A parcela ${pPaga} já consta liquidada no histórico` : 'Parcela duplicada dentro da própria planilha'
                });
                continue;
            }

            // Regra: Quebra de Total de Parcelas
            const baselineTotalParcelas = history.length > 0 ? Number(history[0].parcelas) : pTotal;
            if (pTotal !== baselineTotalParcelas) {
                missingInfoRowsReport.push({
                    nf: currentNf, data: `Tentou /${pTotal} (Histórico é /${baselineTotalParcelas})`, loja: currentLoja,
                    motivo: `Inconsistência matemática: Esta NF foi registrada originalmente com ${baselineTotalParcelas} parcelas`
                });
                continue;
            }

            // Regra: Quebra de Sequência
            const todasAsParcelasProcessadas = [...history.map((p: any) => Number(p.parcelaPaga)), ...alreadyUploadedInCurrentFile];
            let sequenciaInvalida = false;
            for (let i = 1; i < pPaga; i++) {
                if (!todasAsParcelasProcessadas.includes(i)) {
                    sequenciaInvalida = true;
                    break;
                }
            }

            if (sequenciaInvalida) {
                missingInfoRowsReport.push({
                    nf: currentNf, data: `Parcela: ${pPaga}/${pTotal}`, loja: currentLoja,
                    motivo: `Quebra cronológica: Não é possível importar a parcela ${pPaga} sem ter processado as anteriores.`
                });
                continue;
            }

            // Regra: Teto Financeiro (Protegido contra flutuação de dízimas de float)
            const somaValorHistorico = history.reduce((sum: number, p: any) => sum + Number(p.baseIcms || 0), 0);
            const somaValorArquivoAtual = validPaymentsToInsert.filter((p: any) => p.nf === currentNf).reduce((sum: number, p: any) => sum + p.baseIcms, 0);
            const novoValorAtual = Number(row.baseIcms || 0);

            const acumuladoTotal = Number((somaValorHistorico + somaValorArquivoAtual + novoValorAtual).toFixed(2));

            if (acumuladoTotal > (saleData.baseIcms + 0.10)) {
                missingInfoRowsReport.push({
                    nf: currentNf, data: `Soma Acumulada: R$ ${acumuladoTotal.toFixed(2)}`, loja: currentLoja,
                    motivo: `Estouro financeiro: Acúmulo de parcelas excede o valor bruto da NF original (R$ ${saleData.baseIcms})`
                });
                continue;
            }

            // Aprovação da Linha
            alreadyUploadedInCurrentFile.push(pPaga);
            currentFileTracking.set(currentNf, alreadyUploadedInCurrentFile);
            affectedSaleIds.add(saleData.id);

            validPaymentsToInsert.push({
                nf: currentNf,
                rawStoreName: currentLoja,
                parcelaPaga: pPaga,
                parcelas: pTotal,
                baseIcms: novoValorAtual,
                repasse: Number(row.repasse) || 0,
                comissaoVenda: Number(row.comissaoVenda) || 0,
                comissaoFrete: Number(row.comissaoFrete) || 0,
                fretesTaxas: Number(row.fretesTaxas) || 0,
                storeId: currentLoja,
                saleId: saleData.id
            });
        }

        // ============================================================================
        // FASE 3: PERSISTÊNCIA EM CHUNKS E TRANSAÇÃO SEGURA
        // ============================================================================
        let batchId: string | null = null;
        const totalPaymentsToSave = validPaymentsToInsert.length;

        if (totalPaymentsToSave > 0) {
            console.log(`📦 Iniciando gravação de ${totalPaymentsToSave} repasses válidos...`);

            // Calcula o total acumulado da base ICMS das parcelas válidas aprovadas
            const totalBaseIcmsCalculado = validPaymentsToInsert.reduce((sum: number, p: any) => sum + (Number(p.baseIcms) || 0), 0);

            const batchTransaction = await sequelize.transaction();
            try {
                const batch = await Batch.create({
                    name: `Lote de Repasse Importado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}`,
                    type: 'PAYMENTS',
                    salesCount: totalPaymentsToSave,
                    totalBaseIcms: Number(totalBaseIcmsCalculado.toFixed(2))
                }, { transaction: batchTransaction });

                batchId = batch.id;
                validPaymentsToInsert.forEach((p: any) => p.batchId = batchId);

                // Divisão em blocos de persistência em lote segura
                const chunks = _.chunk(validPaymentsToInsert, 2000);
                for (const chunk of chunks) {
                    await Payment.bulkCreate(chunk, { transaction: batchTransaction });
                }

                await batchTransaction.commit();
                console.log(`✅ Pagamentos persistidos com sucesso no Lote ${batchId}.`);
            } catch (error) {
                await batchTransaction.rollback();
                console.error("❌ Falha na persistência principal da importação:", error);
                throw new Error('Erro crítico ao salvar os pagamentos no banco de dados. Operação integralmente revertida.');
            }

            // ============================================================================
            // FASE 4: SINCRONIZAÇÃO DE STATUS DE VENDAS
            // ============================================================================
            const statusTransaction = await sequelize.transaction();
            try {
                // Executa o Resolver corrigido para strings minúsculas em lotes de alta velocidade
                await SaleStatusResolver.syncStatusForSales(Array.from(affectedSaleIds), statusTransaction);
                await statusTransaction.commit();
                console.log(`🏁 Status das vendas impactadas atualizados!`);
            } catch (statusError) {
                await statusTransaction.rollback();
                console.error("⚠️ Atenção: Pagamentos salvos, mas houve erro ao recalcular o status das vendas:", statusError);
            }
        }

        console.timeEnd('⏳ Tempo total de Importação');

        return {
            message: totalPaymentsToSave > 0 ? 'Auditoria e Importação concluídas com sucesso!' : 'Nenhum pagamento válido para importar.',
            batchId: batchId || 'Nenhum lote gerado',
            salesImported: totalPaymentsToSave,
            duplicatedCount: duplicatedRowsReport.length,
            missingInfoCount: missingInfoRowsReport.length,
            duplicatedRows: duplicatedRowsReport,
            missingRows: missingInfoRowsReport
        };
    }

    async listBatches(page: number = 1, limit: number = 10) {
        const offset = (page - 1) * limit;

        const { rows, count } = await Batch.findAndCountAll({
            where: { type: 'PAYMENTS' },
            attributes: [
                'id',
                'name',
                'createdAt',
                'updatedAt',
                [
                    // Corrigido: Garante o uso de tableName ao invés de name para evitar erros de SQL no Postgres
                    sequelize.literal(`(SELECT COUNT(*)::int FROM "${Payment.tableName}" AS "payments" WHERE "payments"."batch_id" = "${Batch.tableName}"."id")`),
                    'salesCount'
                ],
                [
                    // Corrigido: Explicitando tipo any nos parâmetros da função callback interna se necessário (aqui é string SQL literal)
                    sequelize.literal(`(SELECT COALESCE(SUM("payments"."repasse"), 0)::float FROM "${Payment.tableName}" AS "payments" WHERE "payments"."batch_id" = "${Batch.tableName}"."id")`),
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

    async getBatchDetails(batchId: string) {
        const batch = await Batch.findOne({
            where: { id: batchId, type: 'PAYMENTS' },
            include: [{
                model: Payment, as: 'payments', required: false,
                include: [
                    { model: Store, as: 'store', required: false },
                    { model: Sale, as: 'sale', required: false }
                ]
            }]
        });

        if (!batch) throw new Error('Lote de repasse não encontrado.');
        return batch;
    }

    async deleteBatch(batchId: string) {
        const batch = await Batch.findOne({ where: { id: batchId, type: 'PAYMENTS' } });
        if (!batch) throw new Error('Lote de repasse não encontrado.');

        // 1. Encontra quais pagamentos pertencem a este lote
        const targetPayments = await Payment.findAll({
            where: { batchId },
            attributes: ['saleId', 'parcelaPaga', 'nf'],
            raw: true
        });

        if (targetPayments.length === 0) {
            await batch.destroy();
            return { message: 'O lote estava vazio e foi removido com sucesso.', salesAffected: 0 };
        }

        const targetMap = _.groupBy(targetPayments, 'saleId');
        const uniqueSaleIds = Object.keys(targetMap);

        // 2. Busca O RESTO do histórico dessas vendas para validar quebras cronológicas
        const allHistoricalPayments = await Payment.findAll({
            where: { saleId: { [Op.in]: uniqueSaleIds } },
            attributes: ['batchId', 'saleId', 'parcelaPaga', 'nf'],
            raw: true
        });

        const generalHistoryMap = _.groupBy(allHistoricalPayments, 'saleId');

        // 3. Validação Cronológica (Trava da Parcela)
        for (const saleId of uniqueSaleIds) {
            const paymentsBeingDeleted = targetMap[saleId] || [];
            const historyTotal = generalHistoryMap[saleId] || [];

            const maxParcelaDeleted = Math.max(...paymentsBeingDeleted.map((p: any) => Number(p.parcelaPaga)));
            const currentNf = paymentsBeingDeleted[0]?.nf || '';

            // Verifica se existe alguma parcela MAIOR que a que estamos apagando em OUTRO lote
            const hasFutureActiveParcela = historyTotal.some((p: any) => p.batchId !== batchId && Number(p.parcelaPaga) > maxParcelaDeleted);

            if (hasFutureActiveParcela) {
                throw new Error(`Operação Abortada! A NF ${currentNf} possui parcelas posteriores (Ex: Parcela 2) liquidadas in lotes mais recentes. Exclua os lotes mais novos primeiro.`);
            }
        }

        // 4. Executa a deleção e o rollback dos status com segurança transacional
        const deleteTransaction = await sequelize.transaction();
        try {
            // A. Deleta explicitamente os pagamentos do lote primeiro (evita FK Constraint fails)
            await Payment.destroy({ where: { batchId }, transaction: deleteTransaction });

            // B. Deleta o Lote
            await Batch.destroy({ where: { id: batchId }, transaction: deleteTransaction });

            // C. Recalcula os status das vendas que tiveram pagamentos removidos
            await SaleStatusResolver.syncStatusForSales(uniqueSaleIds, deleteTransaction);

            await deleteTransaction.commit();

            return {
                message: 'Lote de repasse removido com sucesso. Os status das vendas afetadas foram recalculados e retornados para o estado anterior.',
                salesAffected: uniqueSaleIds.length
            };
        } catch (error) {
            await deleteTransaction.rollback();
            throw new Error(`Falha ao excluir o lote: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
        }
    }
}