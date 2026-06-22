import {
  Table,
  Column,
  Model,
  DataType,
  PrimaryKey,
  ForeignKey,
  BelongsTo,
  HasMany
} from 'sequelize-typescript';
import { Marketplace } from './Marketplace';
import { Sale } from './Sale';
import { Payment } from './Payment';

@Table({ tableName: 'stores', timestamps: false })
export class Store extends Model {
  @PrimaryKey
  @Column(DataType.STRING)
  declare id: string;

  @Column({ type: DataType.STRING, unique: true })
  declare name: string;

  @ForeignKey(() => Marketplace)
  @Column(DataType.STRING)
  declare marketplaceId: string;

  @BelongsTo(() => Marketplace)
  declare marketplace: Marketplace;

  @HasMany(() => Sale)
  declare sales: Sale[];

  @HasMany(() => Payment)
  declare payments: Payment[];
}