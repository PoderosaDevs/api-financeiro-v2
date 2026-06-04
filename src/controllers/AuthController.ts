import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { User } from '../models/index'; 

const JWT_SECRET = process.env.JWT_SECRET || 'sua_chave_secreta_super_segura';

export class AuthController {
  
  // ==========================================
  // REGISTRO DE USUÁRIO (Com Diagnóstico)
  // ==========================================
  register = async (req: Request, res: Response) => {
    console.log('\n--- 📥 [REQUISIÇÃO] POST /register ---');
    const { email, password, name } = req.body;
    console.log(`Dados recebidos -> Nome: ${name}, Email: ${email}, Possui Senha?: ${password ? 'SIM' : 'NÃO'}`);

    try {
      if (!email || !password || !name) {
        console.log('⚠️ [Validação] Campos obrigatórios ausentes.');
        return res.status(400).json({ error: 'Nome, email e senha são obrigatórios.' });
      }

      console.log('🔍 [Banco] Verificando se e-mail já existe...');
      const userExists = await User.findOne({ where: { email } });
      if (userExists) {
        console.log('⚠️ [Validação] E-mail já cadastrado.');
        return res.status(400).json({ error: 'Este e-mail já está cadastrado.' });
      }

      console.log('🔐 [Bcrypt] Gerando o hash da senha...');
      const hashedPassword = await bcrypt.hash(password, 8);
      console.log('Hash gerado com sucesso.');

      console.log('💾 [Banco] Criando registro do usuário...');
      const user = await User.create({
        name,
        email,
        passwordHash: hashedPassword
      });
      console.log(`✅ [Banco] Usuário salvo no Render com ID: ${user.id}`);

      return res.status(201).json({ 
        message: "Usuário criado com sucesso!", 
        data: { 
          id: user.id,
          name: user.name, 
          email: user.email 
        } 
      });
    } catch (error) {
      console.error('🚨 [ERRO CRÍTICO NO REGISTRO]:', error);
      return res.status(500).json({ error: 'Erro ao registrar usuário.' });
    }
  }

  // ==========================================
  // LOGIN DE USUÁRIO (Super Diagnóstico)
  // ==========================================
  login = async (req: Request, res: Response) => {
    console.log('\n--- 🔑 [REQUISIÇÃO] POST /login ---');
    const { email, password } = req.body;
    console.log(`Tentativa de login para o e-mail: ${email}`);

    try {
      if (!email || !password) {
        console.log('⚠️ [Validação] Email ou senha não informados no corpo da requisição.');
        return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
      }

      console.log('🔍 [Banco] Buscando usuário pelo e-mail informado...');
      const user = await User.findOne({ where: { email } });
      
      console.log(`📊 [Diagnóstico Banco] Usuário encontrado?: ${user ? '✅ SIM' : '❌ NÃO'}`);

      if (!user) {
        console.log('⚠️ [Autenticação] E-mail não encontrado no banco.');
        return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
      }

      // IMPORTANTE: Exibe o valor exato lido do banco para garantir que não veio undefined/null
      console.log(`🔑 [Diagnóstico Campos] ID no banco: ${user.id}`);
      console.log(`🔑 [Diagnóstico Campos] Hash guardado na tabela: ${user.passwordHash}`);

      console.log('🔐 [Bcrypt] Comparando a senha enviada com o hash do banco...');
      const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
      
      console.log(`📊 [Diagnóstico Senha] A senha bate?: ${isPasswordValid ? '✅ SIM' : '❌ NÃO'}`);

      if (!isPasswordValid) {
        console.log('⚠️ [Autenticação] Senha incorreta.');
        return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
      }

      console.log('🎟️ [JWT] Assinando o token com a chave secreta...');
      const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '1d' });
      console.log('Token assinado com sucesso!');

      return res.json({
        message: "Login efetuado com sucesso!",
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email
        }
      });
    } catch (error) {
      console.error('🚨 [ERRO CRÍTICO NO LOGIN]:', error);
      return res.status(500).json({ error: 'Erro ao fazer login.' });
    }
  }
}