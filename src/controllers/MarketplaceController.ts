import { Request, Response } from 'express';
import { Marketplace, Store } from '../models/index';
import { sequelize } from '../config/database'; // Importamos o sequelize para usar funções de contagem

export class MarketplaceController {
  // Criar Marketplace (Ex: id: "mercadolivre", name: "Mercado Livre")
  async create(req: Request, res: Response) {
    const { id, name } = req.body;

    try {
      if (!id || !name) {
        return res.status(400).json({ error: 'ID e Nome são obrigatórios.' });
      }

      // Converte o ID para minúsculas para manter o padrão (ex: "MELI" vira "meli")
      const formattedId = id.toLowerCase().trim();

      const exists = await Marketplace.findByPk(formattedId);
      if (exists) {
        return res.status(400).json({ error: 'Este Marketplace já está cadastrado.' });
      }

      const marketplace = await Marketplace.create({
        id: formattedId,
        name
      });

      return res.status(201).json(marketplace);
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao criar marketplace.' });
    }
  }

  // Listar todos os Marketplaces com a contagem de lojas vinculadas
  async list(req: Request, res: Response) {
    try {
      const marketplaces = await Marketplace.findAll({
        attributes: {
          include: [
            // Cria um sub-select/agregação para contar as lojas vinculadas, simulando o _count do Prisma
            [
              sequelize.literal(`(
                SELECT COUNT(*)
                FROM stores AS store
                WHERE store."marketplaceId" = "Marketplace".id
              )`),
              'storesCount'
            ]
          ]
        }
      });

      return res.json(marketplaces);
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao buscar marketplaces.' });
    }
  }

  // Atualizar o nome de um Marketplace
  async update(req: Request, res: Response) {
    const { id } = req.params;
    const { name } = req.body;

    try {
      const marketplace = await Marketplace.findByPk(id);
      if (!marketplace) {
        return res.status(404).json({ error: 'Marketplace não encontrado.' });
      }

      await marketplace.update({ name });

      return res.json(marketplace);
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao atualizar marketplace.' });
    }
  }

  // Deletar um Marketplace
  async delete(req: Request, res: Response) {
    const { id } = req.params;

    try {
      const marketplace = await Marketplace.findByPk(id);
      if (!marketplace) {
        return res.status(404).json({ error: 'Marketplace não encontrado.' });
      }

      await marketplace.destroy();
      return res.json({ message: 'Marketplace deletado com sucesso.' });
    } catch (error) {
      return res.status(500).json({ 
        error: 'Erro ao deletar marketplace. Verifique se existem lojas vinculadas a ele.' 
      });
    }
  }
}