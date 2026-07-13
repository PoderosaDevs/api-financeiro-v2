// src/services/BatchService.ts
import { Op } from 'sequelize';
import { sequelize } from '../config/database';
import { Batch, Sale, Payment, Devolution } from '../models/index';

export interface BatchListFilters {
  search?: string;                          // busca por nome ou id do lote
  type?: 'SALES' | 'PAYMENTS' | 'DEVOLUTIONS'; // filtro por tipo de lote
  dateFrom?: string;                        // 'YYYY-MM-DD'
  dateTo?: string;                          // 'YYYY-MM-DD'
  valueMin?: number;                        // faixa de valor (totalBaseIcms)
  valueMax?: number;
}

export class BatchService {
  async listAllBatches(page: number = 1, limit: number = 10, filters: BatchListFilters = {}) {
    const offset = (page - 1) * limit;
    const { search, type, dateFrom, dateTo, valueMin, valueMax } = filters;

    // Expressões CASE reaproveitadas tanto no SELECT (attributes) quanto no WHERE (filtro de valor),
    // evitando duplicar a regra de negócio em dois lugares diferentes.
    const salesCountExpression = `(
      CASE 
        WHEN "Batch"."type" = 'PAYMENTS' THEN 
          (SELECT COUNT(*)::int FROM "${Payment.tableName}" AS "p" WHERE "p"."batch_id" = "Batch"."id")
        WHEN "Batch"."type" = 'DEVOLUTIONS' THEN 
          (SELECT COUNT(*)::int FROM "${Devolution.tableName}" AS "d" WHERE "d"."batch_id" = "Batch"."id")
        ELSE 
          (SELECT COUNT(*)::int FROM "${Sale.tableName}" AS "s" WHERE "s"."batchId" = "Batch"."id")
      END
    )`;

    const totalValueExpression = `(
      CASE 
        WHEN "Batch"."type" = 'PAYMENTS' THEN 
          (SELECT COALESCE(SUM("p"."repasse"), 0)::float FROM "${Payment.tableName}" AS "p" WHERE "p"."batch_id" = "Batch"."id")
        WHEN "Batch"."type" = 'DEVOLUTIONS' THEN 
          (SELECT COALESCE(SUM("d"."valor"), 0)::float FROM "${Devolution.tableName}" AS "d" WHERE "d"."batch_id" = "Batch"."id")
        ELSE 
          (SELECT COALESCE(SUM("s"."baseIcms"), 0)::float FROM "${Sale.tableName}" AS "s" WHERE "s"."batchId" = "Batch"."id")
      END
    )`;

    // ─── MONTAGEM DINÂMICA DOS FILTROS ───
    const andConditions: any[] = [];

    // Busca textual por nome do lote ou id (cast pra texto, já que id costuma ser UUID)
    if (search && search.trim()) {
      const term = search.trim();
      andConditions.push({
        [Op.or]: [
          { name: { [Op.iLike]: `%${term}%` } },
          sequelize.where(
            sequelize.cast(sequelize.col('Batch.id'), 'text'),
            { [Op.iLike]: `%${term}%` }
          )
        ]
      });
    }

    // Filtro por tipo de lote. 'SALES' cobre tudo que não é PAYMENTS/DEVOLUTIONS,
    // já que a coluna "type" pode não ter um valor literal 'SALES' salvo (mesma lógica do ELSE acima).
    if (type === 'PAYMENTS' || type === 'DEVOLUTIONS') {
      andConditions.push({ type });
    } else if (type === 'SALES') {
      andConditions.push({
        [Op.or]: [
          { type: { [Op.notIn]: ['PAYMENTS', 'DEVOLUTIONS'] } },
          { type: null }
        ]
      });
    }

    // Filtro por intervalo de datas (createdAt)
    if (dateFrom || dateTo) {
      const createdAtRange: Record<symbol, Date> = {};
      if (dateFrom) createdAtRange[Op.gte] = new Date(`${dateFrom}T00:00:00`);
      if (dateTo) createdAtRange[Op.lte] = new Date(`${dateTo}T23:59:59`);
      andConditions.push({ createdAt: createdAtRange });
    }

    // Filtro por faixa de valor total — usa a mesma expressão CASE do SELECT, direto no WHERE
    // (não dá pra usar HAVING aqui pois não há GROUP BY: é uma subquery escalar por linha, não um agregado).
    if (valueMin !== undefined && valueMin !== null && !isNaN(valueMin)) {
      andConditions.push(sequelize.literal(`${totalValueExpression} >= ${Number(valueMin)}`));
    }
    if (valueMax !== undefined && valueMax !== null && !isNaN(valueMax)) {
      andConditions.push(sequelize.literal(`${totalValueExpression} <= ${Number(valueMax)}`));
    }

    const where = andConditions.length ? { [Op.and]: andConditions } : undefined;

    const { rows, count } = await Batch.findAndCountAll({
      attributes: [
        'id',
        'name',
        'type',
        'createdAt',
        'updatedAt',
        [sequelize.literal(salesCountExpression), 'salesCount'],
        [sequelize.literal(totalValueExpression), 'totalBaseIcms']
      ],
      where,
      order: [['createdAt', 'DESC']],
      limit: limit,
      offset: offset
    });

    return {
      data: rows,
      meta: {
        totalRecords: count,
        totalPages: Math.ceil(count / limit),
        currentPage: page,
        pageSize: limit
      }
    };
  }
}