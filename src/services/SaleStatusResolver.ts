import { Transaction, Op } from 'sequelize';
import { Sale, Payment } from '../models/index';
import _ from 'lodash';

export class SaleStatusResolver {
    static async syncStatusForSales(saleIds: string[], transaction?: Transaction): Promise<void> {
        if (!saleIds || saleIds.length === 0) return;

        // 1. Busca todas as vendas originais impactadas
        const sales = await Sale.findAll({
            where: { id: { [Op.in]: saleIds } },
            attributes: ['id', 'baseIcms'],
            transaction,
            raw: true
        });

        const salesPriceMap = new Map<string, number>();
        sales.forEach(s => salesPriceMap.set(s.id, Number(s.baseIcms || 0)));

        // 2. Busca todos os pagamentos atuais dessas vendas pós-inserção/deleção
        const allPayments = await Payment.findAll({
            where: { saleId: { [Op.in]: saleIds } },
            attributes: ['saleId', 'parcelaPaga', 'parcelas', 'baseIcms'],
            transaction,
            raw: true
        });

        const paymentsGroupedBySale = _.groupBy(allPayments, 'saleId');

        // Baldes utilizando as strings EXATAS do seu sistema
        const salesToMarkAsPendente: string[] = [];
        const salesToMarkAsParcialmentePago: string[] = [];
        const salesToMarkAsPago: string[] = [];

        // 3. Processamento Analítico
        for (const saleId of saleIds) {
            const currentPayments = paymentsGroupedBySale[saleId] || [];

            // Se não tem mais pagamento (ex: deletou o lote inteiro), volta para PENDENTE
            if (currentPayments.length === 0) {
                salesToMarkAsPendente.push(saleId);
                continue;
            }

            const totalParcelasConfiguradas = Number(currentPayments[0].parcelas || 1);
            const baseIcmsOriginalVenda = salesPriceMap.get(saleId) || 0;
            const totalParcelasPagasAtualmente = currentPayments.length;
            const somaValoresPagos = currentPayments.reduce((sum, p) => sum + Number(p.baseIcms || 0), 0);

            // ─── FLUXO A: VENDA UNITÁRIA (1/1) ───
            if (totalParcelasConfiguradas === 1) {
                // Se pagou tudo (com tolerância de 10 centavos), é PAGO. Senão, é PARCIALMENTE_PAGO.
                if (somaValoresPagos >= (baseIcmsOriginalVenda - 0.10)) {
                    salesToMarkAsPago.push(saleId);
                } else {
                    salesToMarkAsParcialmentePago.push(saleId);
                }
                continue; 
            }

            // ─── FLUXO B: VENDA PARCELADA (Ex: 2x, 3x, 12x) ───
            // É considerado PAGO se: o número de parcelas pagas atingiu o total OU o valor financeiro bateu
            if (
                totalParcelasPagasAtualmente >= totalParcelasConfiguradas || 
                somaValoresPagos >= (baseIcmsOriginalVenda - 0.10)
            ) {
                salesToMarkAsPago.push(saleId);
            } else {
                // Se pagou 1 de 3 parcelas, cai aqui perfeitamente
                salesToMarkAsParcialmentePago.push(saleId);
            }
        }

        // ============================================================================
        // FASE 4: PERSISTÊNCIA EM MASSA (Bulk Updates ajustados)
        // ============================================================================
        const updatePromises: Promise<any>[] = [];

        if (salesToMarkAsPendente.length > 0) {
            updatePromises.push(
                Sale.update(
                    { status: 'PENDENTE' }, 
                    { where: { id: { [Op.in]: salesToMarkAsPendente } }, transaction }
                )
            );
        }

        if (salesToMarkAsParcialmentePago.length > 0) {
            updatePromises.push(
                Sale.update(
                    { status: 'PARCIALMENTE_PAGO' }, 
                    { where: { id: { [Op.in]: salesToMarkAsParcialmentePago } }, transaction }
                )
            );
        }

        if (salesToMarkAsPago.length > 0) {
            updatePromises.push(
                Sale.update(
                    { status: 'PAGO' }, 
                    { where: { id: { [Op.in]: salesToMarkAsPago } }, transaction }
                )
            );
        }

        await Promise.all(updatePromises);
    }
}