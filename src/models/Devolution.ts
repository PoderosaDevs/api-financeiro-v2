import { Table, Column, Model, DataType, PrimaryKey, Default, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { Batch, Sale } from '.';

@Table({ tableName: 'devolutions', timestamps: true })
export class Devolution extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.STRING, allowNull: false })
  declare nf: string;

  @Column({ type: DataType.STRING, allowNull: false, field: 'id_devolucao' })
  declare idDevolucao: string; // Coluna 'DEVOLUCAO' da planilha

  @Column({
    type: DataType.DECIMAL(10, 2),
    allowNull: false,
    field: 'base_icms',
    get() {
      const value = this.getDataValue('baseIcms');
      return value ? Number(value) : 0;
    }
  })
  declare baseIcms: number; 

  @Column({
    type: DataType.DECIMAL(10, 2),
    allowNull: false,
    get() {
      const value = this.getDataValue('valor');
      return value ? Number(value) : 0;
    }
  })
  declare valor: number; 

  @Column({ type: DataType.STRING, allowNull: false, field: 'motivo_devolucao' })
  declare motivoDevolucao: string;

  @Column({ type: DataType.STRING, allowNull: true, field: 'tratativa' })
  declare tratativa: string;

  @ForeignKey(() => Batch)
  @Column({ type: DataType.UUID, allowNull: false, field: 'batch_id' })
  declare batchId: string;

  @BelongsTo(() => Batch)
  declare batch: Batch;

  @ForeignKey(() => Sale)
  @Column({ type: DataType.UUID, allowNull: false, field: 'sale_id' })
  declare saleId: string;

  @BelongsTo(() => Sale)
  declare sale: Sale;
}