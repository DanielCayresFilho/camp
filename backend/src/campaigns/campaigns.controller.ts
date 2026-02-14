import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Query,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { FileInterceptor } from "@nestjs/platform-express";
import { CampaignsService } from "./campaigns.service";
import { CreateCampaignDto } from "./dto/create-campaign.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { Role } from "@prisma/client";
import csv from "csv-parser";
import { Readable } from "stream";

@ApiTags("campaigns")
@ApiBearerAuth("JWT-auth")
@Controller("campaigns")
@UseGuards(JwtAuthGuard, RolesGuard)
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) { }

  @Post()
  @Roles(Role.admin, Role.supervisor, Role.digital)
  create(@Body() createCampaignDto: CreateCampaignDto) {
    console.log(
      "📋 [Campaigns] Criando campanha:",
      JSON.stringify(createCampaignDto, null, 2)
    );
    return this.campaignsService.create(createCampaignDto);
  }

  @Post("preview")
  @UseInterceptors(FileInterceptor("file"))
  async preview(
    @UploadedFile() file: Express.Multer.File,
    @Body("templateId") templateId: string
  ) {
    if (!file || !templateId) {
      throw new BadRequestException("File and templateId are required");
    }
    const contacts: any[] = [];
    const stream = Readable.from(file.buffer.toString());

    return new Promise((resolve, reject) => {
      stream
        .pipe(csv({ separator: ';' }))
        .on("data", (row) => {
          if (contacts.length === 0) { // Only need the first row for preview
            // Same parsing logic as uploadCsv
            const cleanRow: any = {};
            Object.keys(row).forEach(k => cleanRow[k.trim()] = row[k]);

            const phoneKey = Object.keys(cleanRow).find(k =>
              ['phone', 'telefone', 'celular', 'mobile', 'tel'].includes(k.toLowerCase())
            );
            const nameKey = Object.keys(cleanRow).find(k =>
              ['name', 'nome', 'cliente'].includes(k.toLowerCase())
            );

            const reservedKeys = [
              'phone', 'telefone', 'celular', 'mobile', 'tel', 'zap', 'contact', 'contato',
              'name', 'nome', 'cliente', 'customer',
              'cpf', 'contrato', 'contract', 'segment', 'mensagem', 'message'
            ];

            const variables: Record<string, string> = {};
            Object.keys(cleanRow).forEach(key => {
              if (!reservedKeys.includes(key.toLowerCase())) {
                variables[key] = cleanRow[key];
              }
            });

            contacts.push({
              phone: phoneKey ? cleanRow[phoneKey] : '00000000',
              name: nameKey ? cleanRow[nameKey] : 'Nome Teste',
              variables
            });
          }
        })
        .on("end", async () => {
          if (contacts.length === 0) return reject(new BadRequestException("CSV empty"));
          try {
            const result = await this.campaignsService.previewTemplate(
              contacts[0],
              parseInt(templateId)
            );
            resolve(result);
          } catch (e) { reject(e); }
        })
        .on("error", reject);
    });
  }

  @Post(":id/upload")
  @Roles(Role.admin, Role.supervisor, Role.digital)
  @UseInterceptors(FileInterceptor("file"))
  async uploadCsv(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body("message") message?: string,
    @Body("useTemplate") useTemplate?: string,
    @Body("templateId") templateId?: string
  ) {
    console.log(`📤 [Campaigns] Upload CSV recebido para campanha ${id}`);
    console.log(
      `📄 [Campaigns] Arquivo:`,
      file
        ? { name: file.originalname, size: file.size, mimetype: file.mimetype }
        : "NENHUM"
    );
    console.log(`📝 [Campaigns] Mensagem: ${message || "Nenhuma"}`);
    console.log(`🛠️ [Campaigns] Params: useTemplate=${useTemplate} (${typeof useTemplate}), templateId=${templateId} (${typeof templateId})`);

    if (!file) {
      console.error("❌ [Campaigns] Arquivo CSV não recebido");
      throw new BadRequestException("Arquivo CSV é obrigatório");
    }

    const contacts = [];
    const stream = Readable.from(file.buffer.toString());
    console.log(`📊 [Campaigns] Processando CSV...`);

    return new Promise((resolve, reject) => {
      stream
        .pipe(csv({ separator: ';' }))
        .on("data", (row) => {
          console.log("📝 [Campaigns] Row do CSV:", row);
          // Ignorar linhas vazias ou sem telefone
          // Limpeza robusta do telefone: manter apenas dígitos
          // Identificar coluna de telefone (vários aliases possíveis)
          const phoneKey = Object.keys(row).find(k =>
            ['phone', 'telefone', 'celular', 'mobile', 'tel', 'zap', 'contact', 'contato'].includes(k.toLowerCase().trim())
          );

          const phoneRaw = (phoneKey ? row[phoneKey] : (row.phone || row.telefone || '')).toString();
          const phoneClean = phoneRaw.replace(/\D/g, '');

          // Validar se sobrou um número válido (pelo menos 8 dígitos)
          if (phoneClean.length < 8) return;

          // Identificar nome
          const nameKey = Object.keys(row).find(k => ['name', 'nome', 'cliente', 'customer'].includes(k.toLowerCase().trim()));
          const nameVal = nameKey ? row[nameKey] : (row.name || row.nome || '');

          // 🚀 FEATURE: Capturar colunas extras para variáveis dinâmicas (ex: link, codigo, valor)
          const reservedKeys = [
            'phone', 'telefone', 'celular', 'mobile', 'tel', 'zap', 'contact', 'contato',
            'name', 'nome', 'cliente', 'customer',
            'cpf', 'contrato', 'contract', 'segment', 'mensagem', 'message'
          ];

          const variables: Record<string, string> = {};
          Object.keys(row).forEach(key => {
            const cleanKey = key.trim();
            // Ignorar chaves vazias ou reservadas
            if (cleanKey && !reservedKeys.includes(cleanKey.toLowerCase())) {
              variables[cleanKey] = row[key];
            }
          });

          // Log de debug para a primeira linha para validar extração
          if (contacts.length === 0) {
            console.log(`🔍 [Campaigns] Debug CSV Row 1: Keys=${Object.keys(row).join(',')}`);
            console.log(`🔍 [Campaigns] Debug CSV Row 1: Variables Extracted=${JSON.stringify(variables)}`);
          }

          contacts.push({
            name: nameVal || '', // Nome opcional, envia vazio se não tiver
            phone: phoneClean,
            cpf: row.cpf || undefined,
            contract: row.contrato || row.contract || undefined,
            segment: row.segment ? parseInt(row.segment) : undefined,
            message: row.mensagem || row.message || undefined, // Mensagem personalizada por contato
            variables: Object.keys(variables).length > 0 ? variables : undefined // Variáveis extras
          });
        })
        .on("end", async () => {
          console.log(
            `✅ [Campaigns] CSV processado: ${contacts.length} contatos encontrados`
          );
          try {
            const result = await this.campaignsService.uploadCampaign(
              +id,
              contacts,
              message,
              useTemplate !== undefined ? useTemplate === "true" : undefined,
              templateId ? parseInt(templateId) : undefined
            );
            console.log("✅ [Campaigns] Upload concluído:", result);
            resolve(result);
          } catch (error) {
            console.error("❌ [Campaigns] Erro no upload:", error.message);
            reject(error);
          }
        })
        .on("error", (error) => {
          console.error("❌ [Campaigns] Erro ao processar CSV:", error.message);
          reject(error);
        });
    });
  }

  @Get('summary')
  getSummaries(@Query('search') search?: string) {
    return this.campaignsService.getCampaignSummaries({ search });
  }

  @Get('dashboard-stats')
  @Roles(Role.admin, Role.supervisor)
  getDashboardStats() {
    return this.campaignsService.getDashboardStats();
  }

  @Get()
  @Roles(Role.admin, Role.supervisor, Role.digital)
  findAll() {
    return this.campaignsService.findAll();
  }

  @Get(":id")
  @Roles(Role.admin, Role.supervisor, Role.digital)
  findOne(@Param("id") id: string) {
    return this.campaignsService.findOne(+id);
  }

  @Get("stats/:name")
  @Roles(Role.admin, Role.supervisor, Role.digital)
  getStats(@Param("name") name: string) {
    return this.campaignsService.getStats(name);
  }

  @Get("next-messages/:name")
  @Roles(Role.admin, Role.supervisor, Role.digital)
  getNextMessages(@Param("name") name: string) {
    return this.campaignsService.getNextMessages(name);
  }

  @Delete(":id")
  @Roles(Role.admin, Role.supervisor, Role.digital)
  remove(@Param("id") id: string) {
    return this.campaignsService.remove(+id);
  }

  @Delete("by-name/:name")
  @Roles(Role.admin, Role.supervisor, Role.digital)
  removeByName(@Param("name") name: string) {
    return this.campaignsService.removeByName(name);
  }
}
