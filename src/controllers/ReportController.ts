import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Sale, Store, Marketplace, Payment } from '../models/index';

const VALID_TYPES = ['store', 'marketplace', 'status', 'monthly', 'weekly'] as const;
type ReportType = typeof VALID_TYPES[number];

const MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// Retorna a segunda-feira da semana de uma data ISO 'YYYY-MM-DD'
function startOfWeekIso(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const day = date.getDay(); // 0 = domingo
  const diff = (day === 0 ? -6 : 1) - day; // volta até a segunda-feira
  date.setDate(date.getDate() + diff);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatBrDate(iso: string): string {
  const parts = iso.split('-');
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : iso;
}

// ==========================================================================
// ReportController
// ------------------------------------------------------------------------
// Controller 100% de LEITURA. Reaproveita a mesma lógica de cálculo já usada
// em SaleController (receita bruta, comissões, frete, líquido recebido) só
// que agrupada por diferentes dimensões. Não escreve em nenhuma tabela.
//
// Observação sobre "CMV": o schema atual não guarda custo de mercadoria
// (não existe custo de produto/estoque em nenhuma tabela), então não é
// possível calcular CMV real. Em vez disso, os relatórios trazem uma
// "margem sobre faturamento" (receita líquida recebida / receita bruta),
// que é o proxy financeiro mais próximo disponível nos dados existentes.
// ==========================================================================
export class ReportController {
  generate = async (req: Request, res: Response) => {
    try {
      const { startDate, endDate, marketplaceId, storeId } = req.query;
      const type = (req.query.type as string) || 'marketplace';

      if (!VALID_TYPES.includes(type as ReportType)) {
        return res.status(400).json({ error: `Tipo de relatório inválido. Use um de: ${VALID_TYPES.join(', ')}` });
      }

      const whereCondition: any = {};
      if (startDate && endDate) {
        whereCondition.date = { [Op.between]: [startDate, endDate] };
      } else if (startDate) {
        whereCondition.date = { [Op.gte]: startDate };
      } else if (endDate) {
        whereCondition.date = { [Op.lte]: endDate };
      }
      if (storeId) whereCondition.storeId = storeId;

      const marketplaceWhere = marketplaceId ? { id: marketplaceId } : undefined;

      // Otimização de performance: assim como no DashboardController, evitamos juntar
      // Sale + Payment numa única query (o JOIN de hasMany duplica a linha da venda uma
      // vez por parcela/pagamento). Buscamos as vendas e os pagamentos separadamente
      // (cada query sem duplicação) e juntamos os dois lados em memória por "saleId".
      const saleRows: any[] = await Sale.findAll({
        where: whereCondition,
        order: [['date', 'ASC']],
        attributes: ['id', 'date', 'baseIcms', 'status', 'storeId'],
        include: [{
          model: Store, as: 'store', required: !!marketplaceId, attributes: ['id', 'name', 'marketplaceId'],
          include: [{ model: Marketplace, as: 'marketplace', attributes: ['id', 'name'], where: marketplaceWhere, required: !!marketplaceId }]
        }],
        raw: true,
        nest: true,
      });

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

      const paymentsBySale = new Map<string, { receitaLiquida: number; comissoes: number; frete: number }>();
      paymentRows.forEach((p: any) => {
        const key = p.saleId;
        const cur = paymentsBySale.get(key) || { receitaLiquida: 0, comissoes: 0, frete: 0 };
        cur.receitaLiquida += Number(p.repasse) || 0;
        cur.comissoes += (Number(p.comissaoVenda) || 0) + (Number(p.comissaoFrete) || 0);
        cur.frete += Number(p.fretesTaxas) || 0;
        paymentsBySale.set(key, cur);
      });

      type RowAcc = {
        key: string; label: string;
        vendas: number; receitaBruta: number; comissoes: number; frete: number; receitaLiquida: number;
      };
      const rowsMap = new Map<string, RowAcc>();

      const totals = { vendas: 0, receitaBruta: 0, comissoes: 0, frete: 0, receitaLiquida: 0 };

      saleRows.forEach((sale: any) => {
        const paymentTotals = paymentsBySale.get(sale.id) || { receitaLiquida: 0, comissoes: 0, frete: 0 };

        const valorBruto = Number(sale.baseIcms) || 0;
        const liquido = paymentTotals.receitaLiquida;
        const comissao = paymentTotals.comissoes;
        const frete = paymentTotals.frete;

        let key: string;
        let label: string;

        switch (type as ReportType) {
          case 'store':
            key = sale.storeId || 'sem-loja';
            label = sale.store?.name || key;
            break;
          case 'marketplace':
            key = sale.store?.marketplace?.id || sale.store?.marketplaceId || 'sem-marketplace';
            label = sale.store?.marketplace?.name || 'Não Mapeado';
            break;
          case 'status':
            key = sale.status ? String(sale.status).toUpperCase() : 'PENDENTE';
            label = key;
            break;
          case 'monthly': {
            key = String(sale.date).slice(0, 7);
            const [y, m] = key.split('-').map(Number);
            label = `${MONTH_LABELS[m - 1]}/${y}`;
            break;
          }
          case 'weekly': {
            key = startOfWeekIso(String(sale.date));
            label = `Semana de ${formatBrDate(key)}`;
            break;
          }
          default:
            key = 'geral';
            label = 'Geral';
        }

        if (!rowsMap.has(key)) {
          rowsMap.set(key, { key, label, vendas: 0, receitaBruta: 0, comissoes: 0, frete: 0, receitaLiquida: 0 });
        }
        const row = rowsMap.get(key)!;
        row.vendas += 1;
        row.receitaBruta += valorBruto;
        row.comissoes += comissao;
        row.frete += frete;
        row.receitaLiquida += liquido;

        totals.vendas += 1;
        totals.receitaBruta += valorBruto;
        totals.comissoes += comissao;
        totals.frete += frete;
        totals.receitaLiquida += liquido;
      });

      const rows = Array.from(rowsMap.values())
        .map(r => ({
          key: r.key,
          label: r.label,
          vendas: r.vendas,
          receitaBruta: Number(r.receitaBruta.toFixed(2)),
          comissoes: Number(r.comissoes.toFixed(2)),
          frete: Number(r.frete.toFixed(2)),
          receitaLiquida: Number(r.receitaLiquida.toFixed(2)),
          ticketMedio: Number((r.receitaBruta / (r.vendas || 1)).toFixed(2)),
          margemPercent: r.receitaBruta > 0 ? Number(((r.receitaLiquida / r.receitaBruta) * 100).toFixed(1)) : 0,
        }))
        .sort((a, b) => (type === 'monthly' || type === 'weekly' ? a.key.localeCompare(b.key) : b.receitaLiquida - a.receitaLiquida));

      return res.json({
        type,
        filtros: { startDate: startDate || null, endDate: endDate || null, marketplaceId: marketplaceId || null, storeId: storeId || null },
        rows,
        totals: {
          vendas: totals.vendas,
          receitaBruta: Number(totals.receitaBruta.toFixed(2)),
          comissoes: Number(totals.comissoes.toFixed(2)),
          frete: Number(totals.frete.toFixed(2)),
          receitaLiquida: Number(totals.receitaLiquida.toFixed(2)),
          margemPercent: totals.receitaBruta > 0 ? Number(((totals.receitaLiquida / totals.receitaBruta) * 100).toFixed(1)) : 0,
        }
      });
    } catch (error) {
      console.error('🚨 Erro ao gerar relatório:', error);
      return res.status(500).json({ error: 'Erro ao gerar relatório.' });
    }
  }
}
