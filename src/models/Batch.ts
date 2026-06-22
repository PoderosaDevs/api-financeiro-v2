import {
  Table,
  Column,
  Model,
  DataType,
  PrimaryKey,
  Default,
  HasMany
} from 'sequelize-typescript';
import { Sale } from './Sale';
import { Payment } from './Payment';
import { Devolution } from './Devolution';

@Table({ tableName: 'batches', timestamps: true })
export class Batch extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column(DataType.STRING)
  declare name: string;

  @Column({
    type: DataType.ENUM('SALES', 'PAYMENTS', 'DEVOLUTIONS'),
    allowNull: false,
    defaultValue: 'SALES'
  })
  declare type: 'SALES' | 'PAYMENTS' | 'DEVOLUTIONS';

  @HasMany(() => Sale, { onDelete: 'CASCADE' })
  declare sales: Sale[];

  @HasMany(() => Payment, { onDelete: 'CASCADE' })
  declare payments: Payment[];

  @HasMany(() => Devolution, { onDelete: 'CASCADE' })
  declare devolutions: Devolution[];
}