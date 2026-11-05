import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { env } from '../config/env.js';

/** Caminhos das telas que consomem os tokens enviados por e-mail. */
const PATHS = {
  resetPassword: '/recuperar-senha',
  activateAccount: '/ativar-conta',
} as const;

/**
 * Envio de e-mails transacionais (convite, recuperação de senha).
 *
 * Sem `SMTP_HOST` configurado — o caso de dev e de testes — o serviço entra em
 * modo "no-op": registra um aviso e resolve a promessa. Assim o ambiente local
 * não precisa de um servidor SMTP para login, convite e reset funcionarem, e o
 * fluxo do produto nunca quebra por causa do e-mail.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter?: Transporter;
  private readonly from: string;
  /** Base dos links enviados por e-mail (`FRONTEND_URL`; dev: localhost:5173). */
  private readonly frontendBaseUrl: string;

  constructor() {
    const config = env();
    this.from = config.MAIL_FROM ?? 'nao-responda@netprofissionais.com.br';
    this.frontendBaseUrl = config.FRONTEND_URL;

    if (!config.SMTP_HOST) {
      this.logger.warn(
        'SMTP_HOST não configurado: e-mails transacionais serão ignorados (modo no-op).',
      );
      return;
    }

    this.transporter = createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT ?? 587,
      // STARTTLS é o padrão dos provedores na 587; na 465 o serviço usa TLS direto.
      secure: (config.SMTP_PORT ?? 587) === 465,
      auth:
        config.SMTP_USER && config.SMTP_PASS
          ? { user: config.SMTP_USER, pass: config.SMTP_PASS }
          : undefined,
    });
  }

  /** Link de redefinição de senha (Tela `01-C-D` / `04-C-D`). */
  async sendPasswordReset(to: string, name: string, token: string): Promise<void> {
    const link = `${this.frontendBaseUrl}${PATHS.resetPassword}?token=${encodeURIComponent(token)}`;

    await this.send({
      to,
      subject: 'Redefinição de senha — NetProfissionais',
      text: [
        `Olá, ${name}.`,
        '',
        'Recebemos um pedido para redefinir a senha da sua conta no NetProfissionais.',
        `Acesse o link para criar uma nova senha: ${link}`,
        '',
        'O link expira em 15 minutos. Se não foi você quem pediu, ignore este e-mail.',
      ].join('\n'),
      html: this.layout(
        `Olá, ${name}.`,
        'Recebemos um pedido para redefinir a senha da sua conta.',
        link,
        'Criar nova senha',
        'O link expira em 15 minutos. Se não foi você quem pediu, ignore este e-mail.',
      ),
    });
  }

  /** Convite para um colaborador entrar na corporação (Modal 01). */
  async sendInvite(
    to: string,
    name: string,
    token: string,
    tenantName: string,
  ): Promise<void> {
    const link = `${this.frontendBaseUrl}${PATHS.activateAccount}?token=${encodeURIComponent(token)}`;

    await this.send({
      to,
      subject: `Convite para ${tenantName} — NetProfissionais`,
      text: [
        `Olá, ${name}.`,
        '',
        `${tenantName} convidou você para acessar o NetProfissionais.`,
        `Ative sua conta e defina sua senha em: ${link}`,
        '',
        'O convite expira em 48 horas.',
      ].join('\n'),
      html: this.layout(
        `Olá, ${name}.`,
        `${tenantName} convidou você para acessar o NetProfissionais.`,
        link,
        'Ativar minha conta',
        'O convite expira em 48 horas.',
      ),
    });
  }

  /** Confirmação de que a conta foi ativada — fecha o onboarding. */
  async sendAccountActivated(to: string, name: string): Promise<void> {
    const link = `${this.frontendBaseUrl}/login`;

    await this.send({
      to,
      subject: 'Sua conta está ativa — NetProfissionais',
      text: [
        `Olá, ${name}.`,
        '',
        'Sua conta foi ativada com sucesso.',
        `Acesse o sistema em: ${link}`,
      ].join('\n'),
      html: this.layout(
        `Olá, ${name}.`,
        'Sua conta foi ativada com sucesso.',
        link,
        'Entrar no sistema',
        'Guarde este e-mail como confirmação do seu cadastro.',
      ),
    });
  }

  /** Envia ou apenas registra, conforme o modo do serviço. */
  private async send(message: {
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<void> {
    if (!this.transporter) {
      this.logger.log(`[no-op] "${message.subject}" para ${message.to}`);
      return;
    }

    const info = await this.transporter.sendMail({
      from: this.from,
      ...message,
    });
    this.logger.log(
      `E-mail "${message.subject}" enviado para ${message.to} (id ${info.messageId})`,
    );
  }

  /**
   * Corpo HTML mínimo e sem imagens externas.
   *
   * Estilo inline porque clientes de e-mail descartam `<style>` com frequência.
   */
  private layout(
    greeting: string,
    intro: string,
    link: string,
    buttonLabel: string,
    footer: string,
  ): string {
    const box = 'font-family:Arial,Helvetica,sans-serif;color:#1f2333;line-height:1.5';

    return [
      `<div style="${box}">`,
      `<p>${greeting}</p>`,
      `<p>${intro}</p>`,
      `<p><a href="${link}" style="display:inline-block;background:#d60037;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none">${buttonLabel}</a></p>`,
      `<p style="font-size:12px;color:#737887">${footer}</p>`,
      `<p style="font-size:12px;color:#737887">NetProfissionais — gerenciador de leads</p>`,
      '</div>',
    ].join('');
  }
}
