import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/services/api";
import { BarChart3, TrendingUp, Clock, DollarSign } from "lucide-react";

interface DashboardStats {
    totalSent: number;
    queueCount: number;
    totalCost: number;
    costPerMessage: number;
}

export function DashboardCampanhas() {
    const [stats, setStats] = useState<DashboardStats>({
        totalSent: 0,
        queueCount: 0,
        totalCost: 0,
        costPerMessage: 0.30,
    });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchStats();
        // Atualizar a cada 30 segundos
        const interval = setInterval(fetchStats, 30000);
        return () => clearInterval(interval);
    }, []);

    const fetchStats = async () => {
        try {
            const response = await api.get("/campaigns/dashboard-stats");
            setStats(response.data);
        } catch (error) {
            console.error("Erro ao carregar estatísticas:", error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <MainLayout title="Dashboard Financeiro de Campanhas">
            <div className="container mx-auto p-4 space-y-6">

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
                            <div className="text-2xl font-bold">{loading ? "..." : stats.totalSent.toLocaleString()}</div>
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
                                {loading ? "..." : `R$ ${stats.totalCost.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Baseado em R$ {stats.costPerMessage.toFixed(2)} por mensagem
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
                            <div className="text-2xl font-bold">{loading ? "..." : stats.queueCount.toLocaleString()}</div>
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
