import {
  Table,
  Column,
  Model,
  DataType,
  PrimaryKey,
  Default
} from 'sequelize-typescript';

@Table({ tableName: 'users', timestamps: true })
export class User extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column(DataType.STRING)
  declare name: string;

  @Column({ type: DataType.STRING, unique: true })
  declare email: string;

  @Column({ type: DataType.STRING, field: 'password_hash' })
  declare passwordHash: string;
}