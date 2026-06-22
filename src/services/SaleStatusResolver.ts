import { Transaction, Op } from 'sequelize';
import { Sale, Payment } from '../models/index';
import { Devolution } from '../models/Devolution';
import _ from 'lodash';

export class SaleStatusResolver {
    static async syncStatusForSales(saleIds: string[], transaction?: Transaction): Promise<void> {
        if (!saleIds || saleIds.length === 0) return;

        // ─── 1. Busca vendas originais ───
        const sales = await Sale.findAll({
            where: { id: { [Op.in]: saleIds } },
            attributes: ['id', 'baseIcms'],
            transaction,
            raw: true
        });

        const salesPriceMap = new Map<string, number>();
        sales.forEach(s => salesPriceMap.set(s.id, Number(s.baseIcms || 0)));

        // ─── 2. Busca pagamentos e devoluções em paralelo ───
        const [allPayments, allDevolutions] = await Promise.all([
            Payment.findAll({
                where: { saleId: { [Op.in]: saleIds } },
                attributes: ['saleId', 'parcelaPaga', 'parcelas', 'baseIcms'],
                transaction,
                raw: true
            }),
            Devolution.findAll({
                where: { saleId: { [Op.in]: saleIds } },
                attributes: ['saleId', 'valor'],
                transaction,
                raw: true
            })
        ]);

        const paymentsGroupedBySale = _.groupBy(allPayments, 'saleId');
        const devolutionsGroupedBySale = _.groupBy(allDevolutions, 'saleId');

        const salesToMarkAs: Map<string, string> = new Map();

        // ─── 3. Loop analítico ───
        for (const saleId of saleIds) {
            const currentPayments = paymentsGroupedBySale[saleId] || [];
            const currentDevolutions = devolutionsGroupedBySale[saleId] || [];

            const baseIcmsOriginalVenda = salesPriceMap.get(saleId) || 0;

            // ── 3A. Resolve o status de PAGAMENTO (lógica original intacta) ──
            let paymentStatus: string = 'PENDENTE';

            if (currentPayments.length > 0) {
                const totalParcelasConfiguradas = Number(currentPayments[0].parcelas || 1);
                const totalParcelasPagasAtualmente = currentPayments.length;
                const somaValoresPagos = currentPayments.reduce((sum, p) => sum + Number(p.baseIcms || 0), 0);

                if (totalParcelasConfiguradas === 1) {
                    paymentStatus = somaValoresPagos >= (baseIcmsOriginalVenda - 0.10)
                        ? 'PAGO'
                        : 'PARCIALMENTE_PAGO';
                } else {
                    const pagamentoCompleto =
                        totalParcelasPagasAtualmente >= totalParcelasConfiguradas ||
                        somaValoresPagos >= (baseIcmsOriginalVenda - 0.10);

                    paymentStatus = pagamentoCompleto ? 'PAGO' : 'PARCIALMENTE_PAGO';
                }
            }

            // ── 3B. Sem devoluções: usa o status de pagamento puro ──
            if (currentDevolutions.length === 0) {
                salesToMarkAs.set(saleId, paymentStatus);
                continue;
            }

            // ── 3C. Com devoluções: sobrescreve o status ──
            const somaDevolvida = Number(
                currentDevolutions.reduce((sum, d) => sum + Number(d.valor || 0), 0).toFixed(2)
            );
            const devolucaoTotal = somaDevolvida >= (baseIcmsOriginalVenda - 0.10);

            // Tabela de decisão: paymentStatus × devolução total/parcial
            if (devolucaoTotal) {
                // Devolução total sobrescreve tudo — a venda foi integralmente devolvida
                salesToMarkAs.set(saleId, 'DEVOLVIDO');
            } else {
                // Devolução parcial: o prefixo depende de onde o pagamento estava
                switch (paymentStatus) {
                    case 'PAGO':
                        salesToMarkAs.set(saleId, 'PARCIALMENTE_DEVOLVIDO');
                        break;
                    case 'PARCIALMENTE_PAGO':
                        // Pago parcialmente E devolvido parcialmente — usa PARCIALMENTE_DEVOLVIDO
                        // pois a devolução é o estado mais crítico para o operador saber
                        salesToMarkAs.set(saleId, 'PARCIALMENTE_DEVOLVIDO');
                        break;
                    case 'PENDENTE':
                        // Existe devolução mas nenhum pagamento registrado — estado anômalo,
                        // mantém PARCIALMENTE_DEVOLVIDO para forçar revisão manual
                        salesToMarkAs.set(saleId, 'PARCIALMENTE_DEVOLVIDO');
                        break;
                    default:
                        salesToMarkAs.set(saleId, paymentStatus);
                }
            }
        }

        // ─── 4. Agrupa por status e faz bulk update ───
        const grouped = _.groupBy(Array.from(salesToMarkAs.entries()), ([, status]) => status);

        const updatePromises = Object.entries(grouped).map(([status, entries]) => {
            const ids = entries.map(([id]) => id);
            return Sale.update(
                { status },
                { where: { id: { [Op.in]: ids } }, transaction }
            );
        });

        await Promise.all(updatePromises);
    }
}