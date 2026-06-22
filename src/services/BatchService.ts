// src/services/BatchService.ts
import { sequelize } from '../config/database';
import { Batch, Sale, Payment, Devolution } from '../models/index';

export class BatchService {
  async listAllBatches(page: number = 1, limit: number = 10) {
    const offset = (page - 1) * limit;

    const { rows, count } = await Batch.findAndCountAll({
      attributes: [
        'id',
        'name',
        'type', 
        'createdAt',
        'updatedAt',
        [
          // Subqueries para contagem de registros baseadas no tipo de lote (com suporte a DEVOLUTIONS)
          sequelize.literal(`(
            CASE 
              WHEN "Batch"."type" = 'PAYMENTS' THEN 
                (SELECT COUNT(*)::int FROM "${Payment.tableName}" AS "p" WHERE "p"."batch_id" = "Batch"."id")
              WHEN "Batch"."type" = 'DEVOLUTIONS' THEN 
                (SELECT COUNT(*)::int FROM "${Devolution.tableName}" AS "d" WHERE "d"."batch_id" = "Batch"."id")
              ELSE 
                (SELECT COUNT(*)::int FROM "${Sale.tableName}" AS "s" WHERE "s"."batchId" = "Batch"."id")
            END
          )`),
          'salesCount'
        ],
        [
          // Subqueries para soma financeira dos lotes baseadas no tipo de lote
          sequelize.literal(`(
            CASE 
              WHEN "Batch"."type" = 'PAYMENTS' THEN 
                (SELECT COALESCE(SUM("p"."repasse"), 0)::float FROM "${Payment.tableName}" AS "p" WHERE "p"."batch_id" = "Batch"."id")
              WHEN "Batch"."type" = 'DEVOLUTIONS' THEN 
                (SELECT COALESCE(SUM("d"."valor"), 0)::float FROM "${Devolution.tableName}" AS "d" WHERE "d"."batch_id" = "Batch"."id")
              ELSE 
                (SELECT COALESCE(SUM("s"."baseIcms"), 0)::float FROM "${Sale.tableName}" AS "s" WHERE "s"."batchId" = "Batch"."id")
            END
          )`),
          'totalBaseIcms'
        ]
      ],
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