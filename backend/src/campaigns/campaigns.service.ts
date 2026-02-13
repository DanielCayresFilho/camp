import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../prisma.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { CampaignContact } from './dto/upload-campaign.dto';
import { ContactsService } from '../contacts/contacts.service';
import { UsersService } from '../users/users.service';
import { PhoneValidationService } from '../phone-validation/phone-validation.service';
import { ControlPanelService } from '../control-panel/control-panel.service';
@Injectable()
export class CampaignsService {
  constructor(
    @InjectQueue('campaigns') private campaignsQueue: Queue,
    private prisma: PrismaService,
    private contactsService: ContactsService,
    private usersService: UsersService,
    private phoneValidationService: PhoneValidationService,
    private controlPanelService: ControlPanelService,
  ) { }

  async create(createCampaignDto: CreateCampaignDto) {
    // Converter endTime (HH:mm) para DateTime do dia atual
    let endTimeDate: Date | null = null;
    if (createCampaignDto.endTime) {
      const [hours, minutes] = createCampaignDto.endTime.split(':').map(Number);
      endTimeDate = new Date();
      endTimeDate.setHours(hours, minutes, 0, 0);
      // Se o horário já passou hoje, definir para amanhã
      if (endTimeDate < new Date()) {
        endTimeDate.setDate(endTimeDate.getDate() + 1);
      }
    }

    return this.prisma.campaign.create({
      data: {
        name: createCampaignDto.name,
        contactName: '',
        contactPhone: '',
        contactSegment: parseInt(createCampaignDto.segment),
        speed: createCampaignDto.speed,
        useTemplate: createCampaignDto.useTemplate || false,
        templateId: createCampaignDto.templateId,
        templateVariables: createCampaignDto.templateVariables
          ? JSON.stringify(createCampaignDto.templateVariables)
          : null,
        endTime: endTimeDate,
      },
    });
  }

  async uploadCampaign(
    campaignId: number,
    contacts: CampaignContact[],
    message?: string,
    useTemplate?: boolean,
    templateId?: number,
  ) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) {
      throw new NotFoundException('Campanha não encontrada');
    }

    // Buscar linhas ATIVAS do segmento (não precisa de operadores online)
    const segmentLines = await this.prisma.linesStock.findMany({
      where: {
        lineStatus: 'active',
        ...(campaign.contactSegment ? { segment: campaign.contactSegment } : {}),
      },
    });

    // Se não tiver linhas no segmento, tentar segmento "Padrão"
    let availableLines = segmentLines.map(line => line.id);

    if (availableLines.length === 0) {
      const defaultSegment = await this.prisma.segment.findUnique({
        where: { name: 'Padrão' },
      });

      if (defaultSegment) {
        const defaultLines = await this.prisma.linesStock.findMany({
          where: {
            lineStatus: 'active',
            segment: defaultSegment.id,
          },
        });
        availableLines = defaultLines.map(line => line.id);
      }
    }

    if (availableLines.length === 0) {
      throw new BadRequestException('Nenhuma linha ativa disponível para disparo');
    }

    console.log(`📤 [Campanha] ${contacts.length} contatos serão disparados usando ${availableLines.length} linhas em rotação`);

    // Cada mensagem será agendada com delay individual
    const minDelayMinutes = 0.5; // 30 segundos
    const maxDelayMinutes = 2.5; // 2 minutos e 30 segundos

    // Usar parâmetros do upload ou da campanha
    const finalUseTemplate = useTemplate !== undefined ? useTemplate : (campaign.useTemplate || false);
    const finalTemplateId = templateId !== undefined ? templateId : campaign.templateId;

    // Processar cada contato com delay acumulado
    let accumulatedDelayMs = 0;

    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];

      // Normalizar telefone (remover espaços, hífens, adicionar 55 se necessário)
      const normalizedPhone = this.phoneValidationService.cleanPhone(contact.phone);

      // Rotação round-robin: linha 1, linha 2, linha 1, linha 2...
      const lineIndex = i % availableLines.length;
      const lineId = availableLines[lineIndex];

      // Criar ou atualizar contato
      let existingContact = await this.contactsService.findByPhone(normalizedPhone);
      if (!existingContact) {
        await this.contactsService.create({
          name: contact.name,
          phone: normalizedPhone,
          cpf: contact.cpf,
          contract: contact.contract,
          segment: campaign.contactSegment,
        });
      } else if (contact.cpf || contact.contract) {
        await this.contactsService.update(existingContact.id, {
          cpf: contact.cpf || existingContact.cpf,
          contract: contact.contract || existingContact.contract,
        });
      }

      // Usar mensagem do contato se disponível, senão usar mensagem global
      let contactMessage = contact.message || message;

      // 🚀 ANTI-BAN: Sempre envolver mensagem com saudações hardcoded
      // Se a mensagem for vazia (CSV simplificado) OU não for JSON de greeting, criar o payload
      if (!contactMessage || (contactMessage && !contactMessage.trim().startsWith('{'))) {
        // Buscar saudações configuradas no painel
        const controlPanel = await this.controlPanelService.findOne();
        const configuredGreetings = controlPanel.greetingMessages;

        // Se houver configurações, usar. Se não, fallback para hardcoded (segurança)
        const GREETINGS = (configuredGreetings && configuredGreetings.length > 0)
          ? configuredGreetings
          : [
            "Olá, tudo bem?",
            "Oi, tudo certo?"
          ];

        // Lógica de Conteúdo:
        // 1. Se campaign.useTemplate = true, o conteúdo real será o template (enviado pelo webhook NA RESPOSTA).
        //    Nesse caso, usamos um placeholder aqui para satisfazer a validação do JSON.
        // 2. Se campaign.useTemplate = false, escolhemos uma mensagem aleatória de HARDCODED_CONTENTS (ou mantemos a mensagem original se não for vazio)

        let content = "";

        if (finalUseTemplate) {
          content = "__TEMPLATE_FLOW__"; // Placeholder especial
        } else {
          const HARDCODED_CONTENTS = [
            "Bora forrar na nova plataforma! https://eae.bet/?r=nbjcdxwx indique seus amigos e ganhe recompensas!!",
            "Partiu forrar na nova plataforma! https://eae.bet/?r=nbjcdxwx indique geral e ganhe recompensas!!",
            "Bora aproveitar na nova plataforma! https://eae.bet/?r=nbjcdxwx indica teus amigos e pega recompensas!!",
            "Fechou! Bora forrar na nova plataforma — https://eae.bet/?r=nbjcdxwx indique amigos e ganhe recompensas!!",
            "Aí sim! Bora forrar na nova plataforma. https://eae.bet/?r=nbjcdxwx indique e ganhe recompensas!!",
            "Bora pra cima na nova plataforma! https://eae.bet/?r=nbjcdxwx convide amigos e ganhe recompensas!!",
            "Show! Bora forrar na plataforma nova: https://eae.bet/?r=nbjcdxwx pra indicar amigos e ganhar recompensas!!",
            "Então vamo! Nova plataforma no ar — https://eae.bet/?r=nbjcdxwx indique seus amigos e ganhe recompensas!!",
            "Boa! Bora forrar na nova plataforma. https://eae.bet/?r=nbjcdxwx chama os amigos e ganha recompensas!!",
            "Perfeito! Bora forrar: nova plataforma + https://eae.bet/?r=nbjcdxwx pra indicar amigos e ganhar recompensas!!",
            "Partiu! https://eae.bet/?r=nbjcdxwx da nova plataforma indique amigos e desbloqueie recompensas!!",
            "Bora garantir o nosso na nova plataforma! https://eae.bet/?r=nbjcdxwx indique amigos e ganhe recompensas!!",
            "Fechamento! Nova plataforma aqui — https://eae.bet/?r=nbjcdxwx indique seus amigos e ganhe recompensas!!",
            "Tamo junto! Bora forrar na nova plataforma. https://eae.bet/?r=nbjcdxwx convide amigos e receba recompensas!!",
            "Boa demais! Bora pra nova plataforma — https://eae.bet/?r=nbjcdxwx indique geral e ganhe recompensas!!",
            "Bora de plataforma nova! https://eae.bet/?r=nbjcdxwx indique teus amigos e ganhe recompensas!!",
            "Top! Bora forrar na nova plataforma. https://eae.bet/?r=nbjcdxwx indique amigos e acumule recompensas!!",
            "Aí sim! Partiu forrar na plataforma nova — https://eae.bet/?r=nbjcdxwx indique amigos e ganhe recompensas!!",
            "Excelente! https://eae.bet/?r=nbjcdxwx da nova plataforma: indique seus amigos e ganhe recompensas!!",
            "Demorou! Bora forrar na nova plataforma. https://eae.bet/?r=nbjcdxwx chama os amigos e garante recompensas!!"
          ];
          // Escolher mensagem de conteúdo aleatória
          content = HARDCODED_CONTENTS[Math.floor(Math.random() * HARDCODED_CONTENTS.length)];
        }

        contactMessage = JSON.stringify({
          greeting: GREETINGS,
          content: content,
          csvVariables: contact.variables || {} // 🚀 FEATURE: Armazenar variáveis do CSV
        });
      }

      // Criar registro da campanha
      const campaignRecord = await this.prisma.campaign.create({
        data: {
          name: campaign.name,
          contactName: contact.name,
          contactPhone: normalizedPhone,
          contactSegment: campaign.contactSegment,
          lineReceptor: lineId,
          speed: 'slow', // Sempre lento para anti-ban
          response: false,
          useTemplate: finalUseTemplate,
          templateId: finalTemplateId,
          templateVariables: campaign.templateVariables,
          endTime: campaign.endTime,
          message: contactMessage,
          // HACK: Usar messageId para armazenar o agendamento enquanto não temos o campo scheduledAt
          messageId: `SCHEDULED:${Date.now() + accumulatedDelayMs}`,
        },
      });

      // Adicionar à fila com delay acumulado
      await this.campaignsQueue.add(
        'send-campaign-message',
        {
          campaignId: campaignRecord.id,
          contactName: contact.name,
          contactPhone: normalizedPhone,
          contactSegment: campaign.contactSegment,
          lineId: lineId,
          message: contactMessage,
          useTemplate: finalUseTemplate,
          templateId: finalTemplateId,
          templateVariables: campaign.templateVariables,
        },
        {
          delay: accumulatedDelayMs,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
        }
      );

      // Calcular delay aleatório para próxima mensagem (30s - 2.5min)
      const randomDelayMinutes = minDelayMinutes + Math.random() * (maxDelayMinutes - minDelayMinutes);
      accumulatedDelayMs += randomDelayMinutes * 60 * 1000;

      // PAUSA LONGA: A cada ~20 mensagens, fazer pausa de 5-15 minutos (anti-ban)
      if ((i + 1) % 20 === 0 && i < contacts.length - 1) {
        const longPauseMinutes = 5 + Math.random() * 10; // 5-15 minutos
        accumulatedDelayMs += longPauseMinutes * 60 * 1000;
        console.log(`☕ [Campanha] Pausa longa de ${longPauseMinutes.toFixed(1)}min após ${i + 1} mensagens`);
      }

      console.log(`📤 [Campanha] Contato ${i + 1}/${contacts.length}: ${normalizedPhone} → Linha ${lineId} (delay: ${Math.round(accumulatedDelayMs / 60000)}min)`);
    }

    const estimatedCompletionMs = accumulatedDelayMs;
    const estimatedCompletion = new Date(Date.now() + estimatedCompletionMs);

    return {
      message: `Campanha processada com sucesso. ${contacts.length} contatos agendados para envio.`,
      totalContacts: contacts.length,
      lines: availableLines.length,
      averageDelayMinutes: ((minDelayMinutes + maxDelayMinutes) / 2).toFixed(1),
      estimatedCompletion: estimatedCompletion.toISOString(),
      estimatedDurationMinutes: Math.round(estimatedCompletionMs / 60000),
    };
  }

  async getCampaignSummaries(filters?: any) {
    const { search } = filters || {};

    // Buscar nomes de campanhas únicos
    // Nota: findAll pode ser pesado se não filtrarmos.
    // Ideal: Usar groupBy, mas precisamos ordenação e filtro.

    // Lista todas as campanhas baseada no filtro (pode ser otimizado com raw query futuramente)
    const where: any = {};
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    // Agrupar por nome (Prisma groupBy)
    const grouped = await this.prisma.campaign.groupBy({
      by: ['name', 'contactSegment'],
      where,
      _count: {
        _all: true,
        delivered: true,
        read: true,
      },
      // Precisamos da data mais recente para ordenação
      _max: {
        createdAt: true,
        dateTime: true
      },
      orderBy: {
        _max: {
          createdAt: 'desc'
        }
      }
    });

    // Precisamos de mais detalhes que o groupBy não dá diretamente (como respondedor count, ou failed count)
    // Para performance, vamos iterar e fazer queries adicionais ou aceitar aproximações
    // O groupBy retorna counts de booleans? Não diretamente. delivered e read são boolean.
    // O groupBy do Prisma só conta registros, não valores true.

    // Abordagem Alternativa mais Robustas: Query Raw ou iteração inteligente.
    // Vamos usar o groupBy apenas para pegar os nomes únicos ordenados e quantidades totais,
    // e depois pegar os detalhes SE necessário, ou fazer uma query RAW que é muito mais eficiente.

    const summaries = await Promise.all(grouped.map(async (group) => {
      // Contagens específicas para cada campanha
      const stats = await this.prisma.campaign.aggregate({
        where: { name: group.name },
        _count: {
          id: true, // total
        }
      });

      const sentCount = await this.prisma.campaign.count({
        where: {
          name: group.name,
          dispatchedAt: { not: null }
        }
      });

      const deliveredCount = await this.prisma.campaign.count({
        where: { name: group.name, delivered: true }
      });

      const readCount = await this.prisma.campaign.count({
        where: { name: group.name, read: true }
      });

      const summary = {
        id: group.name, // Usando nome como ID único para a tabela
        name: group.name,
        contactSegment: group.contactSegment,
        createdAt: group._max.createdAt,
        total: stats._count.id,
        sent: sentCount,
        delivered: deliveredCount,
        read: readCount,
        // pending: stats._count.id - sentCount
      };

      // Buscar próxima mensagem agendada
      const nextMessage = await this.prisma.campaign.findFirst({
        where: {
          name: group.name,
          response: false,
          messageId: { startsWith: 'SCHEDULED:' }
        },
        orderBy: {
          messageId: 'asc' // String sort works for fixed length timestamps, but timestamp strings vary in length? 
          // Actually timestamps are usually same length (13 digits). 
          // But risk here: 'SCHEDULED:1...' vs 'SCHEDULED:2...'.
          // Better to just grab one and parse, but 'asc' might be safe enough for approximation.
        },
        select: { messageId: true }
      });

      let nextMessageAt = null;
      if (nextMessage && nextMessage.messageId) {
        try {
          const timestamp = parseInt(nextMessage.messageId.split(':')[1]);
          if (!isNaN(timestamp)) {
            nextMessageAt = new Date(timestamp);
          }
        } catch (e) { }
      }

      return {
        ...summary,
        nextMessageAt
      };
    }));

    return summaries;
  }

  async findAll(filters?: any) {
    // Remover campos inválidos que não existem no schema
    const { search, ...validFilters } = filters || {};

    // Se houver busca por texto, aplicar filtros
    const where = search
      ? {
        ...validFilters,
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { contactName: { contains: search, mode: 'insensitive' } },
          { contactPhone: { contains: search } },
        ],
      }
      : validFilters;

    return this.prisma.campaign.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: number) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
    });

    if (!campaign) {
      throw new NotFoundException(`Campanha com ID ${id} não encontrada`);
    }

    return campaign;
  }

  async remove(id: number) {
    await this.findOne(id);

    return this.prisma.campaign.delete({
      where: { id },
    });
  }

  async removeByName(name: string) {
    // Delete all campaigns with this name
    const result = await this.prisma.campaign.deleteMany({
      where: { name },
    });

    if (result.count === 0) {
      throw new NotFoundException(`Nenhuma campanha encontrada com o nome: ${name}`);
    }

    return { deleted: result.count, name };
  }

  async getStats(campaignName: string) {
    // Buscar todas as campanhas com este nome
    const campaigns = await this.prisma.campaign.findMany({
      where: { name: campaignName },
      select: {
        id: true,
        contactPhone: true,
        response: true,
        delivered: true,
        read: true,
        dispatchedAt: true,
        dateTime: true,
        createdAt: true,
      },
    });

    const total = campaigns.length;
    const sent = campaigns.filter(c => c.response === true).length;
    const failed = campaigns.filter(c => c.response === false && c.dispatchedAt !== null).length;
    const pending = campaigns.filter(c => c.response === false && c.dispatchedAt === null).length;
    const delivered = campaigns.filter(c => c.delivered === true).length;
    const read = campaigns.filter(c => c.read === true).length;

    // Buscar contatos que responderam (verificar na tabela Conversation)
    const contactPhones = campaigns.map(c => c.contactPhone);
    const earliestCampaignTime = campaigns.length > 0
      ? new Date(Math.min(...campaigns.map(c => c.dateTime?.getTime() || c.createdAt.getTime())))
      : new Date();

    // Buscar conversas onde o contato respondeu após o envio da campanha
    const conversations = await this.prisma.conversation.findMany({
      where: {
        contactPhone: { in: contactPhones },
        sender: 'contact', // Mensagens do contato (respostas)
        datetime: { gte: earliestCampaignTime },
      },
      select: {
        contactPhone: true,
      },
    });

    // Contar contatos únicos que responderam
    const uniqueResponders = new Set(conversations.map(c => c.contactPhone));
    const responses = uniqueResponders.size;

    return {
      campaignName,
      totalContacts: total,
      sent,
      pending,
      failed,
      delivered,
      read,
      responses,
      successRate: total > 0 ? ((sent / total) * 100).toFixed(1) : '0',
      deliveryRate: sent > 0 ? ((delivered / sent) * 100).toFixed(1) : '0',
      readRate: sent > 0 ? ((read / sent) * 100).toFixed(1) : '0',
      responseRate: sent > 0 ? ((responses / sent) * 100).toFixed(1) : '0',
    };
  }

  async getNextMessages(campaignName: string) {
    // Buscar mensagens pendentes (response = false) e que tenham agendamento
    const pendingMessages = await this.prisma.campaign.findMany({
      where: {
        name: campaignName,
        response: false,
        messageId: { startsWith: 'SCHEDULED:' },
      },
      select: {
        contactName: true,
        contactPhone: true,
        message: true,
        messageId: true,
      },
      take: 100, // Pegar um lote para ordenar em memória
    });

    // Processar e ordenar por data
    const sortedMessages = pendingMessages
      .map(msg => ({
        contactName: msg.contactName,
        contactPhone: msg.contactPhone,
        message: msg.message,
        timestamp: parseInt(msg.messageId.split(':')[1]),
        scheduledAt: new Date(parseInt(msg.messageId.split(':')[1])).toISOString(),
      }))
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, 5); // Retornar apenas as 5 próximas

    return sortedMessages;
  }

  async getDashboardStats() {
    // 1. Total de disparos realizados: Status response=true ou dispatchedAt != null
    const totalSent = await this.prisma.campaign.count({
      where: {
        dispatchedAt: { not: null },
      },
    });

    // 2. Fila (não despachados): dispatchedAt = null e messageId começa com SCHEDULED ou é null (ainda não processado)
    const queueCount = await this.prisma.campaign.count({
      where: {
        dispatchedAt: null,
      },
    });

    // 3. Custo (R$ 0,30 por mensagem)
    const costPerMessage = 0.30;
    const totalCost = totalSent * costPerMessage;

    return {
      totalSent,
      queueCount,
      totalCost,
      costPerMessage
    };
  }
}
