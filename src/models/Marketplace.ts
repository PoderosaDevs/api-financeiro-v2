import {
  Table,
  Column,
  Model,
  DataType,
  PrimaryKey,
  HasMany
} from 'sequelize-typescript';
import { Store } from './Store';

@Table({ tableName: 'marketplaces', timestamps: false })
export class Marketplace extends Model {
  @PrimaryKey
  @Column(DataType.STRING)
  declare id: string;

  @Column(DataType.STRING)
  declare name: string;

  @HasMany(() => Store)
  declare stores: Store[];
}