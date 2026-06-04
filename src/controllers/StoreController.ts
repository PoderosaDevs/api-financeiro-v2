// src/controllers/StoreController.ts
import { Request, Response } from 'express';
import { Store, Marketplace, Sale } from '../models/index';
import { sequelize } from '../config/database';

export class StoreController {
  // Criar Loja (Ex: id: "Amazon - PBLZ", marketplaceId: "amazon")
  async create(req: Request, res: Response) {
    const { id, name, marketplaceId } = req.body;

    try {
      if (!id || !marketplaceId) {
        return res.status(400).json({ error: 'ID da Loja e ID do Marketplace são obrigatórios.' });
      }

      // Como o ID da loja vem diretamente da planilha (Ex: "Amazon - PBLZ"),
      // mantemos o case sensitive original e apenas limpamos espaços em branco.
      const formattedStoreId = id.trim();
      const formattedMarketplaceId = marketplaceId.toLowerCase().trim();

      // 1. Valida se o Marketplace informado existe no banco
      const marketplaceExists = await Marketplace.findByPk(formattedMarketplaceId);
      if (!marketplaceExists) {
        return res.status(404).json({ error: 'O Marketplace informado não existe.' });
      }

      // 2. Valida se a Loja já está cadastrada
      const storeExists = await Store.findByPk(formattedStoreId);
      if (storeExists) {
        return res.status(400).json({ error: 'Esta Loja já está cadastrada no sistema.' });
      }

      // 3. Cria a loja (Se o 'name' não for enviado, assume o próprio 'id')
      const store = await Store.create({
        id: formattedStoreId,
        name: name ? name.trim() : formattedStoreId,
        marketplaceId: formattedMarketplaceId
      });

      return res.status(201).json(store);
    } catch (error) {
      console.error('Erro ao criar loja:', error);
      return res.status(500).json({ error: 'Erro ao criar loja.' });
    }
  }

  // Listar todas as Lojas com a contagem de vendas vinculadas e dados do Marketplace
  async list(req: Request, res: Response) {
    try {
      const stores = await Store.findAll({
        include: [
          {
            model: Marketplace,
            as: 'marketplace', // Certifique-se de que o alias está correto conforme seus relacionamentos
            attributes: ['id', 'name']
          }
        ],
        attributes: {
          include: [
            // Cria um sub-select para contar as vendas vinculadas a esta loja, idêntico ao que fez no marketplace
            [
              sequelize.literal(`(
                SELECT COUNT(*)
                FROM sales AS sale
                WHERE sale."storeId" = "Store".id
              )`),
              'salesCount'
            ]
          ]
        },
        order: [['id', 'ASC']]
      });

      return res.json(stores);
    } catch (error) {
      console.error('Erro ao listar lojas:', error);
      return res.status(500).json({ error: 'Erro ao buscar lojas.' });
    }
  }

  // Atualizar dados de uma Loja
  async update(req: Request, res: Response) {
    const { id } = req.params;
    const { name, marketplaceId } = req.body;

    try {
      const store = await Store.findByPk(id);
      if (!store) {
        return res.status(404).json({ error: 'Loja não encontrada.' });
      }

      const updateData: any = {};
      
      if (name) updateData.name = name.trim();
      
      if (marketplaceId) {
        const formattedMarketplaceId = marketplaceId.toLowerCase().trim();
        const marketplaceExists = await Marketplace.findByPk(formattedMarketplaceId);
        if (!marketplaceExists) {
          return res.status(404).json({ error: 'O Marketplace informado não existe.' });
        }
        updateData.marketplaceId = formattedMarketplaceId;
      }

      await store.update(updateData);

      return res.json(store);
    } catch (error) {
      console.error('Erro ao atualizar loja:', error);
      return res.status(500).json({ error: 'Erro ao atualizar loja.' });
    }
  }

  // Deletar uma Loja
  async delete(req: Request, res: Response) {
    const { id } = req.params;

    try {
      const store = await Store.findByPk(id);
      if (!store) {
        return res.status(404).json({ error: 'Loja não encontrada.' });
      }

      await store.destroy();
      return res.json({ message: 'Loja deletada com sucesso.' });
    } catch (error) {
      console.error('Erro ao deletar loja:', error);
      return res.status(500).json({ 
        error: 'Erro ao deletar loja. Verifique se existem vendas ou pagamentos vinculados a ela.' 
      });
    }
  }
}