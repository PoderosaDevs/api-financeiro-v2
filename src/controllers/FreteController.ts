// src/controllers/FreteController.ts
import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Frete } from '../models/index';

interface FreteImportRow {
  nf: string;
  fatura: string;
  loja: string;
}

interface FreteImportError {
  nf: string;
  loja: string;
  fatura: string;
  motivo: 'JÁ PAGO' | 'ERRO DESCONHECIDO';
}

export class FreteController {
  // GET /vendas/frete
  async list(req: Request, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const search = (req.query.search as string)?.trim();
      const fatura = (req.query.fatura as string)?.trim();
      const status = req.query.status as string; // 'pendente' | 'pago'

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

      if (status === 'pago') {
        where.fretePago = true;
      } else if (status === 'pendente') {
        where.fretePago = false;
      }

      const { rows, count } = await Frete.findAndCountAll({
        where,
        order: [['nf', 'ASC']],
        limit,
        offset: (page - 1) * limit,
      });

      const vendas = rows.map((frete: any) => ({
        id: frete.id,
        nf: frete.nf,
        loja: frete.storeId,
        fretePago: frete.fretePago,
        NumeroFatura: frete.numeroFatura,
      }));

      return res.json({ vendas, total: count });
    } catch (error) {
      console.error('Erro ao listar fretes:', error);
      return res.status(500).json({ error: 'Erro ao buscar dados de frete.' });
    }
  }

  // GET /vendas/frete/lojas
  // Retorna as strings de loja já cadastradas nos fretes (sem depender da tabela Store)
  async listLojas(req: Request, res: Response) {
    try {
      const fretes = await Frete.findAll({
        attributes: ['storeId'],
        group: ['storeId'],
        order: [['storeId', 'ASC']],
      });

      const lojas = fretes.map((f: any) => f.storeId).filter(Boolean);

      return res.json({ lojas });
    } catch (error) {
      console.error('Erro ao listar lojas de frete:', error);
      return res.status(500).json({ error: 'Erro ao buscar lojas de frete.' });
    }
  }

  // POST /vendas/frete/import
  async import(req: Request, res: Response) {
    const rows: FreteImportRow[] = req.body;

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'Nenhum dado de frete enviado para processamento.' });
    }

    const errors: FreteImportError[] = [];
    let successCount = 0;

    try {
      for (const row of rows) {
        const nf = String(row.nf || '').trim();
        const loja = String(row.loja || '').trim();
        const fatura = String(row.fatura || '').trim();

        try {
          const [frete, created] = await Frete.findOrCreate({
            where: { nf, storeId: loja },
            defaults: {
              nf,
              storeId: loja,
              numeroFatura: fatura,
              fretePago: true,
            } as any,
          });

          if (!created) {
            if ((frete as any).fretePago) {
              errors.push({ nf, loja, fatura, motivo: 'JÁ PAGO' });
              continue;
            }

            await frete.update({
              fretePago: true,
              numeroFatura: fatura,
            } as any);
          }

          successCount++;
        } catch (rowError) {
          console.error(`Erro ao processar frete da NF ${nf}:`, rowError);
          errors.push({ nf, loja, fatura, motivo: 'ERRO DESCONHECIDO' });
        }
      }

      return res.json({ successCount, errors });
    } catch (error) {
      console.error('Erro ao importar fretes:', error);
      return res.status(500).json({ error: 'Erro ao processar importação de fretes.' });
    }
  }
}