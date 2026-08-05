// src/controllers/DifalController.ts
import { Request, Response } from 'express';
import { Op, fn, col, literal } from 'sequelize';
import { Difal } from '../models/index';

const UF_REGEX = /^[A-Z]{2}$/;

interface DifalImportRow {
  nf: string;
  valor: number | string;
  estado: string;
  NumeroFatura?: string;
  data?: string;
  loja: string;
}

interface DifalImportError {
  nf: string;
  loja: string;
  fatura: string;
  estado?: string;
  motivo: 'JÁ IMPORTADO' | 'ESTADO INVÁLIDO' | 'VALOR INVÁLIDO' | 'ERRO DESCONHECIDO';
}

export class DifalController {
  // GET /vendas/difal
  async list(req: Request, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const search = (req.query.search as string)?.trim();
      const fatura = (req.query.fatura as string)?.trim();
      const status = req.query.status as string; // 'pendente' | 'recolhido'
      const estado = (req.query.estado as string)?.trim().toUpperCase();

      const where: any = {};

      if (search) {
        where[Op.or] = [
          { nf: { [Op.iLike]: `%${search}%` } },
          { numeroFatura: { [Op.iLike]: `%${search}%` } },
        ];
      }

      if (fatura) {
        where.numeroFatura = { [Op.iLike]: `%${fatura}%` };
      }

      if (estado) {
        where.estado = estado;
      }

      if (status === 'recolhido') {
        where.difalRecolhido = true;
      } else if (status === 'pendente') {
        where.difalRecolhido = false;
      }

      const { rows, count } = await Difal.findAndCountAll({
        where,
        order: [['nf', 'ASC']],
        limit,
        offset: (page - 1) * limit,
      });

      const vendas = rows.map((difal: any) => ({
        id: difal.id,
        nf: difal.nf,
        valor: Number(difal.valor),
        estado: difal.estado,
        loja: difal.storeId,
        data: difal.data,
        difalRecolhido: difal.difalRecolhido,
        NumeroFatura: difal.numeroFatura,
      }));

      return res.json({ vendas, total: count });
    } catch (error) {
      console.error('Erro ao listar DIFAL:', error);
      return res.status(500).json({ error: 'Erro ao buscar dados de DIFAL.' });
    }
  }

  // GET /vendas/difal/lojas
  async listLojas(req: Request, res: Response) {
    try {
      const difais = await Difal.findAll({
        attributes: ['storeId'],
        group: ['storeId'],
        order: [['storeId', 'ASC']],
      });

      const lojas = difais.map((d: any) => d.storeId).filter(Boolean);

      return res.json({ lojas });
    } catch (error) {
      console.error('Erro ao listar lojas de DIFAL:', error);
      return res.status(500).json({ error: 'Erro ao buscar lojas de DIFAL.' });
    }
  }

  // GET /vendas/difal/metricas
  // Agrega valor total, recolhido e pendente por estado (UF)
  async metricas(req: Request, res: Response) {
    try {
      const rows: any[] = await Difal.findAll({
        attributes: [
          'estado',
          [fn('COUNT', col('id')), 'totalNotas'],
          [fn('SUM', col('valor')), 'valorTotal'],
          [
            fn('SUM', literal(`CASE WHEN "difalRecolhido" = true THEN "valor" ELSE 0 END`)),
            'valorRecolhido',
          ],
          [
            fn('SUM', literal(`CASE WHEN "difalRecolhido" = false THEN "valor" ELSE 0 END`)),
            'valorPendente',
          ],
        ],
        group: ['estado'],
        raw: true,
      });

      const porEstado = rows
        .map((r) => ({
          estado: r.estado,
          totalNotas: Number(r.totalNotas),
          valorTotal: Number(r.valorTotal),
          valorRecolhido: Number(r.valorRecolhido),
          valorPendente: Number(r.valorPendente),
        }))
        .sort((a, b) => b.valorTotal - a.valorTotal);

      const totals = porEstado.reduce(
        (acc, e) => ({
          valorTotalGeral: acc.valorTotalGeral + e.valorTotal,
          valorRecolhidoGeral: acc.valorRecolhidoGeral + e.valorRecolhido,
          valorPendenteGeral: acc.valorPendenteGeral + e.valorPendente,
          totalNotas: acc.totalNotas + e.totalNotas,
        }),
        { valorTotalGeral: 0, valorRecolhidoGeral: 0, valorPendenteGeral: 0, totalNotas: 0 }
      );

      return res.json({ porEstado, ...totals });
    } catch (error) {
      console.error('Erro ao calcular métricas de DIFAL:', error);
      return res.status(500).json({ error: 'Erro ao calcular métricas de DIFAL.' });
    }
  }

  // POST /vendas/difal/import
  async import(req: Request, res: Response) {
    const rows: DifalImportRow[] = req.body;

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'Nenhum dado de DIFAL enviado para processamento.' });
    }

    const errors: DifalImportError[] = [];
    let successCount = 0;

    try {
      for (const row of rows) {
        const nf = String(row.nf || '').trim();
        const loja = String(row.loja || '').trim();
        const fatura = String(row.NumeroFatura || '').trim();
        const estado = String(row.estado || '').trim().toUpperCase();
        const valor = Number(row.valor);

        if (!UF_REGEX.test(estado)) {
          errors.push({ nf, loja, fatura, estado, motivo: 'ESTADO INVÁLIDO' });
          continue;
        }

        if (!valor || valor <= 0 || isNaN(valor)) {
          errors.push({ nf, loja, fatura, estado, motivo: 'VALOR INVÁLIDO' });
          continue;
        }

        try {
          const [, created] = await Difal.findOrCreate({
            where: { nf, storeId: loja },
            defaults: {
              nf,
              storeId: loja,
              estado,
              valor,
              numeroFatura: fatura,
              data: row.data || null,
              difalRecolhido: false,
            } as any,
          });

          if (!created) {
            errors.push({ nf, loja, fatura, estado, motivo: 'JÁ IMPORTADO' });
            continue;
          }

          successCount++;
        } catch (rowError) {
          console.error(`Erro ao processar DIFAL da NF ${nf}:`, rowError);
          errors.push({ nf, loja, fatura, estado, motivo: 'ERRO DESCONHECIDO' });
        }
      }

      return res.json({ successCount, errors });
    } catch (error) {
      console.error('Erro ao importar DIFAL:', error);
      return res.status(500).json({ error: 'Erro ao processar importação de DIFAL.' });
    }
  }

  // PATCH /vendas/difal/recolher
  async recolher(req: Request, res: Response) {
    try {
      const ids: string[] = req.body?.ids;

      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'Nenhum id informado para marcar como recolhido.' });
      }

      const [updated] = await Difal.update(
        { difalRecolhido: true } as any,
        { where: { id: { [Op.in]: ids } } }
      );

      return res.json({ updated });
    } catch (error) {
      console.error('Erro ao marcar DIFAL como recolhido:', error);
      return res.status(500).json({ error: 'Erro ao atualizar status de recolhimento.' });
    }
  }
}