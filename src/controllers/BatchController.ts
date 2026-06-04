import { Request, Response } from 'express';
import { BatchService } from '../services/BatchService';
import { ImportPaymentsService } from '../services/ImportPaymentsService';
import { ImportSalesService } from '../services/ImportSalesService';
import { Batch } from '../models';

const batchService = new BatchService();
const paymentsService = new ImportPaymentsService();
const salesService = new ImportSalesService();

export class BatchController {

  /**
   * Listar todos os lotes (Vendas e Repasses unificados)
   * GET /batches?page=1&limit=10
   */
  async list(req: Request, res: Response) {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 10;

      const batches = await batchService.listAllBatches(page, limit);

      return res.json(batches);
    } catch (error) {
      console.error('Erro ao listar lotes:', error);
      return res.status(500).json({ error: 'Erro ao buscar histórico de lotes.' });
    }
  }

  /**
   * Obter detalhes de um lote específico (com seus respectivos registros vinculados)
   * GET /batches/:id
   */
  async getDetails(req: Request, res: Response) {
    const { id } = req.params;

    try {
      if (!id || id === 'null') {
        return res.status(400).json({ error: 'O ID do lote fornecido é inválido ou obrigatório.' });
      }

      // Ajustado para usar o model importado no topo de forma limpa
      const batchDetails = await Batch.findByPk(id.trim(), { include: { all: true, nested: true } });

      if (!batchDetails) {
        return res.status(404).json({ error: 'Lote de importação não encontrado.' });
      }

      return res.json(batchDetails);
    } catch (error) {
      console.error(`Erro ao buscar detalhes do lote ${id}:`, error);
      return res.status(500).json({ error: 'Erro ao processar requisição dos detalhes do lote.' });
    }
  }

  /**
   * Renomear um lote específico
   * PATCH /batches/:id/rename ou PUT /batches/:id
   */
  async rename(req: Request, res: Response) {
    const { id } = req.params;
    const { name } = req.body;
    const timestamp = new Date().toISOString();

    console.log(`[${timestamp}] [INFO] [RenameBatch] Tentativa de renomear o lote ID: ${id}`);

    try {
      if (!id || id === 'null') {
        return res.status(400).json({ error: 'O ID do lote fornecido é inválido ou obrigatório.' });
      }

      if (!name || typeof name !== 'string' || name.trim() === '') {
        return res.status(400).json({ error: 'O novo nome do lote é obrigatório e deve ser um texto válido.' });
      }

      const formattedId = id.trim();
      const formattedName = name.trim();

      console.log(`[${timestamp}] [INFO] [RenameBatch] Buscando lote no banco de dados...`);
      const batch = await Batch.findByPk(formattedId);

      if (!batch) {
        console.warn(`[${timestamp}] [WARN] [RenameBatch] Lote com ID ${formattedId} não foi encontrado.`);
        return res.status(404).json({ error: 'Lote de importação não encontrado.' });
      }

      // Executa a alteração do nome diretamente no modelo do Sequelize
      batch.name = formattedName;
      await batch.save();

      console.log(`[${timestamp}] [INFO] [RenameBatch] Lote ${formattedId} renomeado para "${formattedName}" com sucesso.`);
      
      return res.json({
        message: 'Lote renomeado com sucesso.',
        batch: {
          id: batch.id,
          name: batch.name,
          type: batch.type,
          updatedAt: batch.updatedAt
        }
      });

    } catch (error) {
      console.error(`[${timestamp}] [ERROR] [RenameBatch] Erro crítico ao renomear lote ${id}:`, error);
      return res.status(500).json({
        error: error instanceof Error ? error.message : 'Erro crítico ao renomear o lote no sistema.'
      });
    }
  }

  /**
   * Deletar um lote e reverter os dados encadeados
   * DELETE /batches/:id
   */
  async delete(req: Request, res: Response) {
    const { id } = req.params;
    const timestamp = new Date().toISOString();

    console.log(`[${timestamp}] [INFO] [DeleteBatch] Iniciando processo de exclusão para o ID: ${id}`);

    try {
      if (!id || id === 'null') {
        console.warn(`[${timestamp}] [WARN] [DeleteBatch] Tentativa de exclusão com ID ausente ou inválido.`);
        return res.status(400).json({ error: 'O ID do lote fornecido é inválido ou obrigatório.' });
      }

      const formattedId = id.trim();

      console.log(`[${timestamp}] [INFO] [DeleteBatch] Buscando lote no banco de dados (ID: ${formattedId})...`);
      const batchExists = await Batch.findByPk(formattedId);

      if (!batchExists) {
        console.warn(`[${timestamp}] [WARN] [DeleteBatch] Lote com ID ${formattedId} não foi encontrado no sistema.`);
        return res.status(404).json({ error: 'Lote de importação não encontrado.' });
      }

      console.log(`[${timestamp}] [INFO] [DeleteBatch] Lote encontrado. Tipo do lote: ${batchExists.type}`);

      let result;

      if (batchExists.type === 'PAYMENTS') {
        console.log(`[${timestamp}] [INFO] [DeleteBatch] Encaminhando exclusão para paymentsService (ID: ${formattedId}).`);
        result = await paymentsService.deleteBatch(formattedId);
      } else {
        console.log(`[${timestamp}] [INFO] [DeleteBatch] Encaminhando exclusão para salesService (ID: ${formattedId}).`);
        result = await salesService.deleteBatch(formattedId);
      }

      console.log(`[${timestamp}] [INFO] [DeleteBatch] Lote ${formattedId} deletado com sucesso. Retornando resposta.`);
      return res.json(result);

    } catch (error) {
      console.error(`[${timestamp}] [ERROR] [DeleteBatch] Erro crítico ao deletar lote ${id}:`, error);

      if (error instanceof Error && error.message.includes('invalid input syntax for type uuid')) {
        return res.status(422).json({
          error: 'Não foi possível excluir o lote. Existem registros vinculados com dados de ID de venda corrompidos ("null") no banco de dados.'
        });
      }

      return res.status(500).json({
        error: error instanceof Error ? error.message : 'Erro crítico ao remover lote do sistema.'
      });
    }
  }
}