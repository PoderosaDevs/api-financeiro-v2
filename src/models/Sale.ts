import {
  Table,
  Column,
  Model,
  DataType,
  PrimaryKey,
  Default,
  ForeignKey,
  BelongsTo,
  HasMany
} from 'sequelize-typescript';
import { Store } from './Store';
import { Batch } from './Batch';
import { Payment } from './Payment';

@Table({ tableName: 'sales', timestamps: true })
export class Sale extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column(DataType.STRING)
  declare nf: string;

  @Column(DataType.DATEONLY)
  declare date: Date;

  @Column({
    type: DataType.DECIMAL(10, 2),
    get() {
      const value = this.getDataValue('baseIcms');
      return value ? Number(value) : 0;
    }
  })
  declare baseIcms: number;

  @Column({
    type: DataType.ENUM(
      'PENDENTE',
      'PARCIALMENTE_PAGO',
      'PARCIALMENTE_REEMBOLSADO',
      'PARCIALMENTE_CONTESTACAO',
      'PARCIALMENTE_DEVOLVIDO',
      'REEMBOLSADO',
      'CONTESTACAO',
      'DEVOLVIDO',
      'PAGO',
      'CANCELADO',
      'FINALIZADO'
    ),
    allowNull: false,
    defaultValue: 'PENDENTE'
  })
  declare status: 'PENDENTE' | 'PARCIALMENTE_PAGO' | 'PARCIALMENTE_REEMBOLSADO' | 'PARCIALMENTE_CONTESTACAO' | 'PARCIALMENTE_DEVOLVIDO' | 'REEMBOLSADO' | 'CONTESTACAO' | 'DEVOLVIDO' | 'PAGO' | 'CANCELADO' | 'FINALIZADO';

  @ForeignKey(() => Store)
  @Column(DataType.STRING)
  declare storeId: string;

  @BelongsTo(() => Store)
  declare store: Store;

  @ForeignKey(() => Batch)
  @Column(DataType.UUID)
  declare batchId: string;

  @BelongsTo(() => Batch)
  declare batch: Batch;

  @HasMany(() => Payment)
  declare payments: Payment[];
}