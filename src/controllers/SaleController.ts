import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Sale, Store, Batch, Marketplace, Payment } from '../models/index';

export class SaleController {

  // ==========================================
  // 1. CRIAR VENDA AVULSA
  // ==========================================
  create = async (req: Request, res: Response) => {
    const { nf, date, baseIcms, storeId, batchId } = req.body;

    try {
      const store = await Store.findByPk(storeId);
      if (!store) return res.status(400).json({ error: 'Loja informada não existe.' });

      const batch = await Batch.findByPk(batchId);
      if (!batch) return res.status(400).json({ error: 'Lote informado não existe.' });

      const sale = await Sale.create({
        nf,
        date: new Date(date),
        baseIcms,
        storeId,
        batchId
      });

      return res.status(201).json(sale);
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao criar venda avulsa.' });
    }
  }

  // ==========================================
  // 2. LISTAR VENDAS (Com Filtros, Status e Métricas Financeiras)
  // ==========================================
  list = async (req: Request, res: Response) => {
    try {
      const {
        page = 1,
        limit = 10,
        search,
        storeId,
        marketplaceId,
        startDate,
        endDate,
        status
      } = req.query;

      const parsedLimit = Number(limit);
      const offset = (Number(page) - 1) * parsedLimit;

      const whereCondition: any = {};

      // ─── REGRA DE ISOLAMENTO: SE HOUVER SEARCH, IGNORA OS OUTROS FILTROS ───
      if (search) {
        const searchStr = String(search).trim();

        // REMOVIDO O '%' DO INÍCIO: Busca estritamente NFs que COMEÇAM com o termo digitado
        whereCondition.nf = { [Op.iLike]: `${searchStr}%` };
      } else {
        // ─── FILTROS NORMAIS (SÓ EXECUTAM SE NÃO HOUVER BUSCA) ───

        // Filtro de Status Compatível (Trata arrays ou string única)
        if (status) {
          if (Array.isArray(status)) {
            whereCondition.status = {
              // Converte todos os elementos do array para MAIÚSCULO
              [Op.in]: status.map(s => String(s).toUpperCase().trim())
            };
          } else {
            // Converte a string única para MAIÚSCULO
            whereCondition.status = String(status).toUpperCase().trim();
          }
        }

        // Filtro por Loja
        if (storeId) {
          whereCondition.storeId = storeId;
        }

        // Filtro por Período
        if (startDate && endDate) {
          whereCondition.date = { [Op.between]: [startDate, endDate] };
        } else if (startDate) {
          whereCondition.date = { [Op.gte]: startDate };
        } else if (endDate) {
          whereCondition.date = { [Op.lte]: endDate };
        }
      }

      // ─── CONSTRUÇÃO SEGURA DOS JOINS ───
      const marketplaceInclude: any = {
        model: Marketplace,
        as: 'marketplace',
        required: false
      };

      // Se NÃO houver busca por texto E houver um marketplaceId selecionado, filtramos no JOIN
      if (!search && marketplaceId) {
        marketplaceInclude.where = { id: marketplaceId };
        marketplaceInclude.required = true;
      }

      const includeCondition: any = [
        {
          model: Store,
          as: 'store',
          // Se filtramos o marketplace acima, a Loja passa a ser obrigatória (INNER JOIN)
          required: (!search && marketplaceId) ? true : false,
          include: [marketplaceInclude]
        },
        {
          model: Payment,
          as: 'payments',
          required: false
        }
      ];

      // Busca paginada nativa do banco
      const { count, rows: sales } = await Sale.findAndCountAll({
        where: whereCondition,
        limit: parsedLimit,
        offset: offset,
        order: [['date', 'DESC']],
        include: includeCondition
      });

      // Mapeia agregando os cálculos financeiros esperados pela tabela
      const formattedData = sales.map((sale: any) => {
        const saleJson = sale.toJSON();
        const payments = saleJson.payments || [];

        let totalRepasse = 0;
        let totalComissoes = 0;
        let totalTaxas = 0;

        payments.forEach((p: any) => {
          totalRepasse += Number(p.repasse) || 0;
          totalComissoes += (Number(p.comissaoVenda) || 0) + (Number(p.comissaoFrete) || 0);
          totalTaxas += Number(p.fretesTaxas) || 0;
        });

        // Garante compatibilidade visual de caixa alta para a tag de status na tabela do front
        const statusUpper = saleJson.status ? saleJson.status.toUpperCase() : 'PENDENTE';

        return {
          ...saleJson,
          totalRepasse: Number(totalRepasse.toFixed(2)),
          totalComissoes: Number(totalComissoes.toFixed(2)),
          totalTaxas: Number(totalTaxas.toFixed(2)),
          status: statusUpper
        };
      });

      return res.json({
        totalItems: count,
        totalPages: Math.ceil(count / parsedLimit),
        currentPage: Number(page),
        data: formattedData
      });

    } catch (error) {
      console.error('🚨 Erro ao filtrar listagem de vendas:', error);
      return res.status(500).json({ error: 'Erro ao listar vendas.' });
    }
  }

  // ==========================================
  // 3. EXPORTAR VENDAS (Mesmos filtros do "list", sem paginação — já devolve achatado pro export)
  // ==========================================
  exportSales = async (req: Request, res: Response) => {
    try {
      const {
        storeId,
        marketplaceId,
        startDate,
        endDate,
        status
      } = req.query;

      // Teto de segurança: evita que uma exportação sem filtro nenhum tente trazer a base inteira de uma vez.
      // Se o volume real ultrapassar isso no dia a dia, o próximo passo é paginar a exportação em lotes.
      const EXPORT_MAX_ROWS = 20000;

      const whereCondition: any = {};

      // Filtro de Status (mesma lógica do list: aceita array ou string única, normaliza pra maiúsculo)
      if (status) {
        if (Array.isArray(status)) {
          whereCondition.status = {
            [Op.in]: status.map(s => String(s).toUpperCase().trim())
          };
        } else {
          whereCondition.status = String(status).toUpperCase().trim();
        }
      }

      // Filtro por Loja
      if (storeId) {
        whereCondition.storeId = storeId;
      }

      // Filtro por Período
      if (startDate && endDate) {
        whereCondition.date = { [Op.between]: [startDate, endDate] };
      } else if (startDate) {
        whereCondition.date = { [Op.gte]: startDate };
      } else if (endDate) {
        whereCondition.date = { [Op.lte]: endDate };
      }

      // ─── CONSTRUÇÃO SEGURA DOS JOINS (mesmo padrão do list) ───
      const marketplaceInclude: any = {
        model: Marketplace,
        as: 'marketplace',
        required: false
      };

      if (marketplaceId) {
        marketplaceInclude.where = { id: marketplaceId };
        marketplaceInclude.required = true;
      }

      const includeCondition: any = [
        {
          model: Store,
          as: 'store',
          required: marketplaceId ? true : false,
          include: [marketplaceInclude]
        },
        {
          model: Payment,
          as: 'payments',
          required: false
        }
      ];

      // Busca tudo que bate com o filtro, sem paginação, respeitando o teto de segurança
      const sales = await Sale.findAll({
        where: whereCondition,
        order: [['date', 'DESC']],
        include: includeCondition,
        limit: EXPORT_MAX_ROWS
      });

      // Achata cada venda + seus pagamentos exatamente no formato que o ExportVendasModal do front espera,
      // evitando reimplementar essa mesma soma de comissões/repasse no client.
      const exportRows = sales.map((sale: any) => {
        const saleJson = sale.toJSON();
        const payments = saleJson.payments || [];

        let comissaoVenda = 0;
        let comissaoFrete = 0;
        let freteETaxas = 0;
        let liquidoRecebido = 0;

        payments.forEach((p: any) => {
          comissaoVenda += Number(p.comissaoVenda) || 0;
          comissaoFrete += Number(p.comissaoFrete) || 0;
          freteETaxas += Number(p.fretesTaxas) || 0;
          liquidoRecebido += Number(p.repasse) || 0;
        });

        let dataFormatada = 'S/D';
        if (saleJson.date) {
          const parts = String(saleJson.date).split('-');
          dataFormatada = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : saleJson.date;
        }

        return {
          nf: saleJson.nf,
          data: dataFormatada,
          loja: saleJson.storeId,
          marketplace: saleJson.store?.marketplace?.name || saleJson.store?.marketplaceId || 'Não Mapeado',
          valorBruto: Number(saleJson.baseIcms) || 0,
          comissaoVenda: Number(comissaoVenda.toFixed(2)),
          comissaoFrete: Number(comissaoFrete.toFixed(2)),
          freteETaxas: Number(freteETaxas.toFixed(2)),
          liquidoRecebido: Number(liquidoRecebido.toFixed(2)),
          status: saleJson.status ? saleJson.status.toUpperCase() : 'PENDENTE'
        };
      });

      return res.json({
        totalItems: exportRows.length,
        truncated: sales.length >= EXPORT_MAX_ROWS, // avisa o front se bateu no teto e pode haver mais dados
        data: exportRows
      });

    } catch (error) {
      console.error('🚨 Erro ao exportar vendas:', error);
      return res.status(500).json({ error: 'Erro ao exportar vendas.' });
    }
  }

  // ==========================================
  // 3. DETALHES DE UMA VENDA (Altamente Detalhado)
  // ==========================================
  show = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
      // Traz a árvore completa de dados para auditoria detalhada na UI
      const sale = await Sale.findByPk(id, {
        include: [
          {
            model: Store,
            as: 'store',
            include: [{ model: Marketplace, as: 'marketplace' }] // 👈 Traz também o canal/logo do marketplace
          },
          { model: Batch, as: 'batch' },
          { model: Payment, as: 'payments' }
        ]
      });

      if (!sale) return res.status(404).json({ error: 'Venda não encontrada.' });

      const saleJson = sale.toJSON();
      const payments = saleJson.payments || [];

      // Calcula os resumos específicos desta única venda para popular modais de detalhes
      let totalRepasse = 0;
      let totalComissoes = 0;
      let totalTaxas = 0;

      payments.forEach((p: any) => {
        totalRepasse += Number(p.repasse) || 0;
        totalComissoes += (Number(p.comissaoVenda) || 0) + (Number(p.comissaoFrete) || 0);
        totalTaxas += Number(p.fretesTaxas) || 0;
      });

      const valorBruto = Number(saleJson.baseIcms) || 0;
      const saldoRestante = Math.max(0, valorBruto - totalRepasse);

      // Devolve o objeto original acrescido de um nó de auditoria completo
      return res.json({
        ...saleJson,
        status: saleJson.status ? saleJson.status.toUpperCase() : 'PENDENTE',
        auditoria: {
          valorBruto,
          totalRepasse: Number(totalRepasse.toFixed(2)),
          totalComissoes: Number(totalComissoes.toFixed(2)),
          totalTaxas: Number(totalTaxas.toFixed(2)),
          saldoRestante: Number(saldoRestante.toFixed(2)),
          totalParcelasRegistradas: payments.length
        }
      });

    } catch (error) {
      console.error(`🚨 Erro ao buscar detalhes da venda ${id}:`, error);
      return res.status(500).json({ error: 'Erro ao buscar dados detalhados da venda.' });
    }
  }

  // ==========================================
  // 4. ATUALIZAR VENDA
  // ==========================================
  update = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { nf, date, baseIcms, storeId } = req.body;

    try {
      const sale = await Sale.findByPk(id);
      if (!sale) return res.status(404).json({ error: 'Venda não encontrada.' });

      await sale.update({
        nf: nf ?? sale.nf,
        date: date ? new Date(date) : sale.date,
        baseIcms: baseIcms ?? sale.baseIcms,
        storeId: storeId ?? sale.storeId
      });

      return res.json(sale);
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao atualizar venda.' });
    }
  }

  // ==========================================
  // 5. DELETAR VENDA
  // ==========================================
  delete = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
      const sale = await Sale.findByPk(id);
      if (!sale) return res.status(404).json({ error: 'Venda não encontrada.' });

      await sale.destroy();
      return res.json({ message: 'Venda deletada com sucesso.' });
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao deletar venda.' });
    }
  }

  // ==========================================
  // 6. RESUMO FINANCEIRO COMPLETO (FILTRADO)
  // ==========================================
  summary = async (req: Request, res: Response) => {
    try {
      // 1. Captura todos os filtros enviados pelo front-end
      const { startDate, endDate, marketplaceId, storeId, status, search } = req.query;

      const whereCondition: any = {};

      // Filtro por Período de Datas
      if (startDate && endDate) {
        whereCondition.date = { [Op.between]: [startDate, endDate] };
      } else if (startDate) {
        whereCondition.date = { [Op.gte]: startDate };
      } else if (endDate) {
        whereCondition.date = { [Op.lte]: endDate };
      }

      // Filtro por Loja específica
      if (storeId) {
        whereCondition.storeId = storeId;
      }

      // Filtro por Status (Suporta string única ou array de múltiplos status)
      if (status) {
        whereCondition.status = Array.isArray(status) ? { [Op.in]: status } : status;
      }

      // Filtro por Termo de Busca (Varre Nota Fiscal ou ID da venda)
      if (search) {
        const searchStr = String(search).trim();
        whereCondition[Op.or] = [
          { nf: { [Op.like]: `%${searchStr}%` } },
          { id: { [Op.like]: `%${searchStr}%` } }
        ];
      }

      const marketplaceStoreInclude = (attrs: string[]): any => {
        if (marketplaceId) {
          return {
            model: Store, as: 'store', required: true, attributes: attrs,
            include: [{ model: Marketplace, as: 'marketplace', where: { id: marketplaceId }, required: true, attributes: [] }]
          };
        }
        return { model: Store, as: 'store', attributes: attrs };
      };

      // 2. Otimização de performance (base grande, 100k+ vendas): buscar Sale + Payment
      // numa única query com "include" faz o JOIN duplicar a linha da venda uma vez por
      // parcela/pagamento — é isso que deixava esse endpoint lento. Em vez disso,
      // buscamos vendas e pagamentos em duas queries independentes (nenhuma duplica
      // linha) e somamos os pagamentos de cada venda em memória por "id" da venda.
      const sales: any[] = await Sale.findAll({
        where: whereCondition,
        attributes: ['id', 'baseIcms'],
        include: [marketplaceStoreInclude([])],
        raw: true,
      });

      const paymentRows: any[] = await Payment.findAll({
        attributes: ['saleId', 'repasse', 'comissaoVenda', 'comissaoFrete', 'fretesTaxas'],
        include: [{
          model: Sale, as: 'sale', required: true, attributes: [],
          where: whereCondition,
          include: [marketplaceStoreInclude([])]
        }],
        raw: true,
      });

      // 3. Inicialização dos totalizadores do Sumário
      let vendasPeriodo = sales.length;
      let receitaBrutaPrevista = 0;
      let receitaConciliadaRecebida = 0;
      let comissoesMarketplace = 0;
      let custosLogisticaFrete = 0;

      // 4. Consolidação matemática cruzando os dados
      sales.forEach((sale: any) => {
        receitaBrutaPrevista += Number(sale.baseIcms) || 0;
      });

      paymentRows.forEach((pay: any) => {
        receitaConciliadaRecebida += (Number(pay.repasse) || 0);
        comissoesMarketplace += (Number(pay.comissaoVenda) || 0) + (Number(pay.comissaoFrete) || 0);
        custosLogisticaFrete += (Number(pay.fretesTaxas) || 0);
      });

      // Cálculo do saldo pendente líquido
      const saldoAReceber = Math.max(0, receitaBrutaPrevista - receitaConciliadaRecebida - comissoesMarketplace - custosLogisticaFrete);

      // 5. Retorno com formatação decimal tratada contra dízimas
      return res.json({
        vendasPeriodo,
        receitaBrutaPrevista: Number(receitaBrutaPrevista.toFixed(2)),
        saldoAReceber: Number(saldoAReceber.toFixed(2)),
        receitaConciliadaRecebida: Number(receitaConciliadaRecebida.toFixed(2)),
        comissoesMarketplace: Number(comissoesMarketplace.toFixed(2)),
        custosLogisticaFrete: Number(custosLogisticaFrete.toFixed(2))
      });

    } catch (error) {
      console.error('🚨 Erro ao calcular resumo financeiro completo:', error);
      return res.status(500).json({ error: 'Erro ao carregar resumo financeiro.' });
    }
  }
}