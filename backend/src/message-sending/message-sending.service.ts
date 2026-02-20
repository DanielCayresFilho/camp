import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CircuitBreakerService } from '../circuit-breaker/circuit-breaker.service';
import { AppLoggerService } from '../logger/logger.service';
import { HumanizationService } from '../humanization/humanization.service';
import { SpintaxService } from '../spintax/spintax.service';
import { PhoneValidationService } from '../phone-validation/phone-validation.service';
import axios from 'axios';

interface SendMessageOptions {
  evolutionUrl: string;
  evolutionKey: string;
  instanceName: string;
  contactPhone: string;
  message: string;
  messageType?: 'text' | 'image' | 'document';
  mediaUrl?: string;
  fileName?: string;
  traceId?: string;
}

@Injectable()
export class MessageSendingService {
  constructor(
    private prisma: PrismaService,
    private circuitBreakerService: CircuitBreakerService,
    private logger: AppLoggerService,
    private spintaxService: SpintaxService,
    private phoneValidationService: PhoneValidationService,
  ) { }

  /**
   * Envia mensagem via Evolution API com circuit breaker e retry inteligente
   */
  async sendMessage(options: SendMessageOptions): Promise<{ success: boolean; error?: string }> {
    const { evolutionUrl, evolutionKey, instanceName, contactPhone, message, messageType, mediaUrl, fileName, traceId } = options;

    try {
      const cleanPhone = this.phoneValidationService.cleanPhone(contactPhone);

      // Aplicar Spintax se necessário
      let finalMessage = message;
      if (this.spintaxService.hasSpintax(message)) {
        finalMessage = this.spintaxService.applySpintax(message);
        this.logger.log(
          `Spintax aplicado: "${message}" → "${finalMessage}"`,
          'MessageSending',
          { traceId },
        );
      }

      // Criar ação para circuit breaker
      const sendAction = async () => {
        if (messageType === 'image' && mediaUrl) {
          return await axios.post(
            `${evolutionUrl}/message/sendMedia/${instanceName}`,
            {
              number: cleanPhone,
              mediaUrl,
              caption: finalMessage,
              mediatype: 'image',
            },
            {
              headers: { 'apikey': evolutionKey },
              timeout: 30000,
            }
          );
        } else if (messageType === 'document' && mediaUrl) {
          return await axios.post(
            `${evolutionUrl}/message/sendMedia/${instanceName}`,
            {
              number: cleanPhone,
              mediatype: 'document',
              media: mediaUrl,
              fileName: fileName || 'document.pdf',
              caption: finalMessage,
            },
            {
              headers: { 'apikey': evolutionKey },
              timeout: 30000,
            }
          );
        } else {
          return await axios.post(
            `${evolutionUrl}/message/sendText/${instanceName}`,
            {
              number: cleanPhone,
              text: finalMessage,
            },
            {
              headers: { 'apikey': evolutionKey },
              timeout: 30000,
            }
          );
        }
      };

      // Executar através do circuit breaker
      const breakerName = `evolution-${instanceName}`;
      const response = await this.circuitBreakerService.execute(
        breakerName,
        sendAction,
        [],
        {
          timeout: 5000, // Timeout reduzido para 5s
          errorThresholdPercentage: 50,
          resetTimeout: 30000,
        },
      );

      this.logger.log(
        `Mensagem enviada com sucesso para ${cleanPhone}`,
        'MessageSending',
        { contactPhone: cleanPhone, messageType, traceId },
      );

      return { success: true };
    } catch (error: any) {
      const errorMessage = error.message || 'Erro desconhecido';
      const isCircuitOpen = error.name === 'CircuitBreakerOpenError';

      this.logger.error(
        `Erro ao enviar mensagem para ${contactPhone}`,
        error.stack,
        'MessageSending',
        {
          contactPhone,
          messageType,
          error: errorMessage,
          isCircuitOpen,
          traceId,
        },
      );

      return {
        success: false,
        error: isCircuitOpen
          ? 'Serviço temporariamente indisponível. Tente novamente em alguns instantes.'
          : errorMessage,
      };
    }
  }

  /**
   * Envia typing indicator
   */
  async sendTypingIndicator(
    evolutionUrl: string,
    evolutionKey: string,
    instanceName: string,
    contactPhone: string,
    isTyping: boolean,
    traceId?: string,
  ): Promise<void> {
    try {
      const cleanPhone = this.phoneValidationService.cleanPhone(contactPhone);

      const sendTypingAction = async () => {
        return await axios.post(
          `${evolutionUrl}/chat/sendTyping/${instanceName}`,
          {
            number: cleanPhone,
            value: isTyping,
          },
          {
            headers: { 'apikey': evolutionKey },
            timeout: 5000,
          }
        );
      };

      const breakerName = `evolution-typing-${instanceName}`;
      await this.circuitBreakerService.execute(breakerName, sendTypingAction, [], {
        timeout: 3000,
        errorThresholdPercentage: 70, // Mais tolerante para typing
      });
    } catch (error: any) {
      // Não bloquear se typing indicator falhar
      this.logger.warn(
        `Erro ao enviar typing indicator`,
        'MessageSending',
        { contactPhone, error: error.message, traceId },
      );
    }
  }
  /**
   * Verifica se o número possui WhatsApp válido
   */
  async checkWhatsappNumber(
    evolutionUrl: string,
    evolutionKey: string,
    instanceName: string,
    contactPhone: string,
  ): Promise<boolean> {
    try {
      const cleanPhone = this.phoneValidationService.cleanPhone(contactPhone);

      const checkAction = async () => {
        const response = await axios.post(
          `${evolutionUrl}/chat/whatsappNumbers/${instanceName}`,
          {
            numbers: [cleanPhone],
          },
          {
            headers: { 'apikey': evolutionKey },
            timeout: 5000,
          }
        );

        // Evolution retorna array de objetos: [{ number, exists: true/false, jid }]
        const data = response.data;
        if (Array.isArray(data) && data.length > 0) {
          return data[0].exists === true;
        }
        return false;
      };

      const breakerName = `evolution-check-${instanceName}`;
      // Usar circuit breaker mas com failback false se erro
      try {
        return await this.circuitBreakerService.execute(breakerName, checkAction, [], {
          timeout: 5000,
          errorThresholdPercentage: 50,
        });
      } catch (e) {
        // Se der erro de conexão/timeout, assumimos que é válido para não bloquear envio indevidamente?
        // OU assumimos que é inválido para não gastar recurso? 
        // User pediu validação "sempre". Se falhar a validação, melhor logar erro e talvez pular ou tentar envio (fail-open vs fail-close).
        // Vou fazer fail-open (retorna true) se for erro de rede, para não travar campanha por instabilidade na API de check,
        // mas logar o erro.
        // REPENSANDO: O usuário quer economizar envio ou limpar lista. Se API falhar, talvez queira tentar enviar.
        this.logger.error(
          `Erro ao validar número ${cleanPhone}`,
          e.stack,
          'MessageSending',
          { error: e.message }
        );
        return true; // Fail-open: tenta enviar mesmo assim
      }

    } catch (error: any) {
      this.logger.error(
        `Erro geral ao validar número ${contactPhone}`,
        error.stack,
        'MessageSending'
      );
      return true; // Fail-open
    }
  }

  /**
   * Envia status de presença (available/unavailable)
   */
  async sendPresence(
    evolutionUrl: string,
    evolutionKey: string,
    instanceName: string,
    contactPhone: string,
    presence: 'available' | 'unavailable' | 'composing' | 'paused',
  ): Promise<void> {
    try {
      const cleanPhone = this.phoneValidationService.cleanPhone(contactPhone);

      const action = async () => {
        return await axios.post(
          `${evolutionUrl}/chat/sendPresence/${instanceName}`,
          {
            number: cleanPhone,
            presence: presence,
          },
          {
            headers: { 'apikey': evolutionKey },
            timeout: 5000,
          }
        );
      };

      const breakerName = `evolution-presence-${instanceName}`;
      await this.circuitBreakerService.execute(breakerName, action, [], {
        timeout: 3000,
        errorThresholdPercentage: 70, // Tolerante
      });
    } catch (error: any) {
      // Fail silently, it's just a cosmetic/anti-ban feature
      this.logger.warn(
        `Erro ao enviar presence ${presence}`,
        'MessageSending',
        { error: error.message }
      );
    }
  }
}

