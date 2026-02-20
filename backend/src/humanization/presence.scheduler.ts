import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { MessageSendingService } from '../message-sending/message-sending.service';

@Injectable()
export class PresenceSchedulerService {
    private readonly logger = new Logger(PresenceSchedulerService.name);

    constructor(
        private prisma: PrismaService,
        private messageSendingService: MessageSendingService,
    ) { }

    // Rodar a cada 5 minutos
    @Cron('*/5 * * * *')
    async handleRandomPresence() {
        this.logger.log('🕵️ [PresenceScheduler] Iniciando ciclo de presença aleatória...');

        try {
            // 1. Buscar linhas ativas
            const activeLines = await this.prisma.linesStock.findMany({
                where: {
                    lineStatus: 'active',
                },
            });

            if (activeLines.length === 0) {
                this.logger.debug('Nenhuma linha ativa para processar.');
                return;
            }

            // 2. Buscar credenciais da Evolution para essas linhas
            const evolutionNames = [...new Set(activeLines.map(l => l.evolutionName))];
            const evolutionInstances = await this.prisma.evolution.findMany({
                where: {
                    evolutionName: { in: evolutionNames },
                },
            });

            const evolutionMap = new Map(evolutionInstances.map(e => [e.evolutionName, e]));

            // 3. Para cada linha, chance de ficar online
            for (const line of activeLines) {
                // Chance de 15% a cada 5 minutos
                const shouldGoOnline = Math.random() < 0.15;
                const evolution = evolutionMap.get(line.evolutionName);

                if (shouldGoOnline && evolution) {
                    const durationSeconds = Math.floor(Math.random() * (40 - 10 + 1) + 10); // 10-40s

                    this.logger.log(
                        `🟢 [PresenceScheduler] Linha ${line.phone} ficará Online por ${durationSeconds}s`
                    );

                    try {
                        // Enviar "Available"
                        await this.messageSendingService.sendPresence(
                            evolution.evolutionUrl,
                            evolution.evolutionKey,
                            evolution.evolutionName,
                            line.phone,
                            'available'
                        );

                        // Agendar "Unavailable"
                        setTimeout(async () => {
                            try {
                                await this.messageSendingService.sendPresence(
                                    evolution.evolutionUrl,
                                    evolution.evolutionKey,
                                    evolution.evolutionName,
                                    line.phone,
                                    'unavailable'
                                );
                                this.logger.log(`⚪ [PresenceScheduler] Linha ${line.phone} agora Offline`);
                            } catch (e) {
                                this.logger.error(`Erro ao definir offline: ${e.message}`);
                            }
                        }, durationSeconds * 1000);
                    } catch (e) {
                        this.logger.error(`Erro ao definir online: ${e.message}`);
                    }
                }
            }
        } catch (error: any) {
            this.logger.error(`Erro no scheduler de presença: ${error.message}`, error.stack);
        }
    }
}
