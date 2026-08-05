import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Sale, Store, Marketplace, Payment } from '../models/index';

// ==========================================================================
// DashboardController
// ------------------------------------------------------------------------
// Controller 100% de LEITURA (somente SELECT). Não cria, altera nem apaga
// nenhum registro de Sale/Payment/Batch — não interfere nas regras de
// negócio sensíveis de importação de vendas/pagamentos/lotes.
//
// Nota de performance: a princípio esse endpoint buscava Sale + Payment numa
// única query com "include" (hasMany). Como cada venda pode ter várias
// parcelas/pagamentos, o JOIN duplica a linha da venda uma vez por
// pagamento — com 100k+ vendas isso multiplicava o volume de dados
// trafegado/hidratado e deixava a resposta lenta (30s+). A solução é buscar
// vendas e pagamentos em DUAS queries separadas (cada uma sem duplicação) e
// juntar os dois lados em memória por "saleId", que é muito mais leve.
// ==========================================================================
export class DashboardController {
  summary = async (req: Request, res: Response) => {
    try {
      const monthsParam = Number(req.query.months);
      const months = Number.isFinite(monthsParam) && monthsParam > 0
        ? Math.min(Math.max(Math.trunc(monthsParam), 1), 12)
        : 6;

      const { marketplaceId, storeId } = req.query;

      // ─── JANELA DE DATAS: do primeiro dia de (months-1) meses atrás até hoje ───
      const now = new Date();
      const rangeEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const rangeStart = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);

      const toIso = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

      const whereCondition: any = {
        date: { [Op.between]: [toIso(rangeStart), toIso(rangeEnd)] }
      };
      if (storeId) whereCondition.storeId = storeId;

      const marketplaceWhere = marketplaceId ? { id: marketplaceId } : undefined;

      // ─── QUERY 1: vendas do período, SEM juntar pagamentos (zero duplicação de linha) ───
      const saleRows: any[] = await Sale.findAll({
        where: whereCondition,
        attributes: ['id', 'nf', 'date', 'baseIcms', 'status', 'storeId'],
        include: [{
          model: Store, as: 'store', required: !!marketplaceId, attributes: ['id', 'name', 'marketplaceId'],
          include: [{
            model: Marketplace, as: 'marketplace', attributes: ['id', 'name'],
            where: marketplaceWhere, required: !!marketplaceId
          }]
        }],
        raw: true,
        nest: true,
      });

      // ─── QUERY 2: pagamentos das vendas do período (join só para filtrar, sem duplicar Sale) ───
      const paymentRows: any[] = await Payment.findAll({
        attributes: ['saleId', 'repasse', 'comissaoVenda', 'comissaoFrete', 'fretesTaxas'],
        include: [{
          model: Sale, as: 'sale', required: true, attributes: [],
          where: whereCondition,
          include: [{
            model: Store, as: 'store', required: !!marketplaceId, attributes: [],
            include: [{ model: Marketplace, as: 'marketplace', attributes: [], where: marketplaceWhere, required: !!marketplaceId }]
          }]
        }],
        raw: true,
      });

      // ─── MERGE: soma os pagamentos de cada venda por saleId ───
      const paymentsBySale = new Map<string, { receitaLiquida: number; comissoes: number; frete: number }>();
      paymentRows.forEach((p: any) => {
        const key = p.saleId;
        const cur = paymentsBySale.get(key) || { receitaLiquida: 0, comissoes: 0, frete: 0 };
        cur.receitaLiquida += Number(p.repasse) || 0;
        cur.comissoes += (Number(p.comissaoVenda) || 0) + (Number(p.comissaoFrete) || 0);
        cur.frete += Number(p.fretesTaxas) || 0;
        paymentsBySale.set(key, cur);
      });

      // ─── ACUMULADORES GERAIS ───
      let vendasPeriodo = 0;
      let receitaBruta = 0;
      let receitaLiquida = 0;
      let comissoes = 0;
      let frete = 0;

      // ─── SÉRIE MENSAL (chave 'YYYY-MM') ───
      const monthlyMap = new Map<string, { vendas: number; receitaBruta: number; receitaLiquida: number }>();
      for (let i = 0; i < months; i++) {
        const d = new Date(rangeStart.getFullYear(), rangeStart.getMonth() + i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        monthlyMap.set(key, { vendas: 0, receitaBruta: 0, receitaLiquida: 0 });
      }

      // ─── AGRUPAMENTO POR MARKETPLACE E POR LOJA ───
      const marketplaceMap = new Map<string, { id: string; name: string; vendas: number; receitaBruta: number; receitaLiquida: number }>();
      const storeMap = new Map<string, { id: string; name: string; marketplace: string; vendas: number; receitaBruta: number; receitaLiquida: number }>();

      // Vendas mais recentes primeiro (para "recentSales"), sem precisar de ORDER BY no banco
      saleRows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

      const recentSales: any[] = [];

      saleRows.forEach((sale: any) => {
        const paymentTotals = paymentsBySale.get(sale.id) || { receitaLiquida: 0, comissoes: 0, frete: 0 };

        const valorBruto = Number(sale.baseIcms) || 0;
        const liquidoVenda = paymentTotals.receitaLiquida;

        vendasPeriodo += 1;
        receitaBruta += valorBruto;
        receitaLiquida += liquidoVenda;
        comissoes += paymentTotals.comissoes;
        frete += paymentTotals.frete;

        const monthKey = String(sale.date).slice(0, 7);
        const bucket = monthlyMap.get(monthKey);
        if (bucket) {
          bucket.vendas += 1;
          bucket.receitaBruta += valorBruto;
          bucket.receitaLiquida += liquidoVenda;
        }

        const marketplaceInfo = sale.store?.marketplace;
        const marketplaceKey = marketplaceInfo?.id || sale.store?.marketplaceId || 'sem-marketplace';
        if (!marketplaceMap.has(marketplaceKey)) {
          marketplaceMap.set(marketplaceKey, {
            id: marketplaceKey,
            name: marketplaceInfo?.name || 'Não Mapeado',
            vendas: 0, receitaBruta: 0, receitaLiquida: 0
          });
        }
        const mBucket = marketplaceMap.get(marketplaceKey)!;
        mBucket.vendas += 1;
        mBucket.receitaBruta += valorBruto;
        mBucket.receitaLiquida += liquidoVenda;

        const storeKey = sale.storeId || 'sem-loja';
        if (!storeMap.has(storeKey)) {
          storeMap.set(storeKey, {
            id: storeKey,
            name: sale.store?.name || storeKey,
            marketplace: marketplaceInfo?.name || 'Não Mapeado',
            vendas: 0, receitaBruta: 0, receitaLiquida: 0
          });
        }
        const sBucket = storeMap.get(storeKey)!;
        sBucket.vendas += 1;
        sBucket.receitaBruta += valorBruto;
        sBucket.receitaLiquida += liquidoVenda;

        if (recentSales.length < 8) {
          recentSales.push({
            id: sale.id,
            nf: sale.nf,
            date: sale.date,
            storeId: sale.storeId,
            storeName: sale.store?.name || sale.storeId,
            marketplaceName: marketplaceInfo?.name || 'Não Mapeado',
            valorBruto: Number(valorBruto.toFixed(2)),
            liquidoRecebido: Number(liquidoVenda.toFixed(2)),
            status: sale.status ? String(sale.status).toUpperCase() : 'PENDENTE'
          });
        }
      });

      const saldoAReceber = Math.max(0, receitaBruta - receitaLiquida - comissoes - frete);
      const ticketMedio = vendasPeriodo > 0 ? receitaBruta / vendasPeriodo : 0;

      // ─── COMPARATIVO MÊS ATUAL x MÊS ANTERIOR ───
      const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevMonthKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

      const currentMonthBucket = monthlyMap.get(currentMonthKey) || { vendas: 0, receitaBruta: 0, receitaLiquida: 0 };
      const prevMonthBucket = monthlyMap.get(prevMonthKey) || { vendas: 0, receitaBruta: 0, receitaLiquida: 0 };

      const pctChange = (atual: number, anterior: number) => {
        if (anterior <= 0) return atual > 0 ? 100 : 0;
        return Number((((atual - anterior) / anterior) * 100).toFixed(1));
      };

      const monthLabels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

      const monthlySeries = Array.from(monthlyMap.entries()).map(([key, value]) => {
        const [year, month] = key.split('-').map(Number);
        return {
          month: key,
          label: `${monthLabels[month - 1]}/${String(year).slice(2)}`,
          vendas: value.vendas,
          receitaBruta: Number(value.receitaBruta.toFixed(2)),
          receitaLiquida: Number(value.receitaLiquida.toFixed(2)),
        };
      });

      const byMarketplace = Array.from(marketplaceMap.values())
        .map(m => ({
          ...m,
          receitaBruta: Number(m.receitaBruta.toFixed(2)),
          receitaLiquida: Number(m.receitaLiquida.toFixed(2)),
        }))
        .sort((a, b) => b.receitaLiquida - a.receitaLiquida);

      const topStores = Array.from(storeMap.values())
        .map(s => ({
          ...s,
          receitaBruta: Number(s.receitaBruta.toFixed(2)),
          receitaLiquida: Number(s.receitaLiquida.toFixed(2)),
        }))
        .sort((a, b) => b.receitaLiquida - a.receitaLiquida)
        .slice(0, 5);

      return res.json({
        range: { start: toIso(rangeStart), end: toIso(rangeEnd), months },
        kpis: {
          vendasPeriodo,
          receitaBruta: Number(receitaBruta.toFixed(2)),
          receitaLiquida: Number(receitaLiquida.toFixed(2)),
          saldoAReceber: Number(saldoAReceber.toFixed(2)),
          comissoes: Number(comissoes.toFixed(2)),
          frete: Number(frete.toFixed(2)),
          ticketMedio: Number(ticketMedio.toFixed(2)),
          vendasMesAtual: currentMonthBucket.vendas,
          receitaMesAtual: Number(currentMonthBucket.receitaBruta.toFixed(2)),
          variacaoReceitaPercent: pctChange(currentMonthBucket.receitaBruta, prevMonthBucket.receitaBruta),
          variacaoVendasPercent: pctChange(currentMonthBucket.vendas, prevMonthBucket.vendas),
        },
        monthlySeries,
        byMarketplace,
        topStores,
        recentSales
      });
    } catch (error) {
      console.error('🚨 Erro ao montar resumo do dashboard:', error);
      return res.status(500).json({ error: 'Erro ao carregar dados do dashboard.' });
    }
  }
}
