import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/services/api";
import { BarChart3, TrendingUp, Clock, DollarSign, Eye, EyeOff, Filter } from "lucide-react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

interface DashboardStats {
    totalSent: number;
    queueCount: number;
    totalCost: number;
    costPerMessage: number;
}

interface CampaignSummary {
    id: string;
    name: string;
    createdAt: string;
    total: number;
}

export function DashboardCampanhas() {
    const [stats, setStats] = useState<DashboardStats>({
        totalSent: 0,
        queueCount: 0,
        totalCost: 0,
        costPerMessage: 0.30,
    });
    const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
    const [selectedCampaign, setSelectedCampaign] = useState<string>("all");
    const [showCost, setShowCost] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchCampaigns();
        fetchStats();
        // Atualizar a cada 30 segundos
        const interval = setInterval(fetchStats, 30000);
        return () => clearInterval(interval);
    }, [selectedCampaign]); // Re-fetch stats when selected campaign changes

    const fetchCampaigns = async () => {
        try {
            const response = await api.get<CampaignSummary[]>("/campaigns/summary");
            setCampaigns(response);
        } catch (error) {
            console.error("Erro ao carregar lista de campanhas:", error);
        }
    };

    const fetchStats = async () => {
        setLoading(true);
        try {
            const query = selectedCampaign && selectedCampaign !== "all"
                ? `?campaignName=${encodeURIComponent(selectedCampaign)}`
                : "";
            const response = await api.get<DashboardStats>(`/campaigns/dashboard-stats${query}`);
            setStats(response);
        } catch (error) {
            console.error("Erro ao carregar estatísticas:", error);
        } finally {
            setLoading(false);
        }
    };

    const toggleCost = () => setShowCost(!showCost);

    return (
        <MainLayout>
            <div className="container mx-auto p-4 space-y-6">
                <h1 className="text-3xl font-bold tracking-tight">Dashboard Financeiro de Campanhas</h1>


                {/* Filters & Actions */}
                <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-card p-4 rounded-lg border shadow-sm">
                    <div className="flex items-center gap-2 w-full md:w-auto">
                        <Filter className="h-4 w-4 text-muted-foreground" />
                        <Select value={selectedCampaign} onValueChange={setSelectedCampaign}>
                            <SelectTrigger className="w-full md:w-[280px]">
                                <SelectValue placeholder="Filtrar por Campanha" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todas as Campanhas</SelectItem>
                                {campaigns.map((camp) => (
                                    <SelectItem key={camp.id} value={camp.name}>
                                        {camp.name} ({camp.total} contatos)
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={toggleCost} className="gap-2">
                            {showCost ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            {showCost ? "Ocultar Custos" : "Exibir Custos"}
                        </Button>
                    </div>
                </div>

                {/* KPI Cards */}
                <div className="grid gap-4 md:grid-cols-3">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">
                                Disparos Realizados
                            </CardTitle>
                            <TrendingUp className="h-4 w-4 text-green-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{loading ? "..." : (stats?.totalSent ?? 0).toLocaleString()}</div>
                            <p className="text-xs text-muted-foreground">
                                Total de mensagens entregues
                            </p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">
                                Custo Total Estimado
                            </CardTitle>
                            <DollarSign className="h-4 w-4 text-red-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">
                                {loading ? "..." : showCost
                                    ? `R$ ${(stats?.totalCost ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
                                    : "R$ ••••••"}
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Baseado em R$ {(stats?.costPerMessage ?? 0).toFixed(2)} por mensagem
                            </p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">
                                Fila de Disparo
                            </CardTitle>
                            <Clock className="h-4 w-4 text-orange-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{loading ? "..." : (stats?.queueCount ?? 0).toLocaleString()}</div>
                            <p className="text-xs text-muted-foreground">
                                Mensagens aguardando envio
                            </p>
                        </CardContent>
                    </Card>
                </div>

                {/* Chart / Detailed View Placeholder */}
                <div className="grid gap-4 md:grid-cols-1">
                    <Card className="col-span-1">
                        <CardHeader>
                            <CardTitle>Visão Geral</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[200px] flex items-center justify-center text-muted-foreground border-2 border-dashed rounded-lg">
                                <div className="text-center">
                                    <BarChart3 className="mx-auto h-12 w-12 opacity-50 mb-2" />
                                    <p>Gráficos detalhados em desenvolvimento</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </MainLayout>
    );
}
