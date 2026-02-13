import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, Save, RotateCcw } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { api } from "@/services/api";

export function ConfiguracaoSaudacao() {
    const [greetings, setGreetings] = useState<string[]>([]);
    const [newGreeting, setNewGreeting] = useState("");
    const [loading, setLoading] = useState(false);
    const [originalGreetings, setOriginalGreetings] = useState<string[]>([]);
    const { toast } = useToast();

    useEffect(() => {
        fetchGreetings();
    }, []);

    const fetchGreetings = async () => {
        try {
            setLoading(true);
            const response = await api.get<{ greetingMessages: string[] }>("/control-panel");
            // Se não tiver saudações configuradas, usar array vazio
            const currentGreetings = response.greetingMessages || [];
            setGreetings(currentGreetings);
            setOriginalGreetings(currentGreetings);
        } catch (error) {
            console.error("Erro ao buscar configurações:", error);
            toast({
                title: "Erro",
                description: "Não foi possível carregar as saudações.",
                variant: "destructive",
            });
        } finally {
            setLoading(false);
        }
    };

    const handleAddGreeting = () => {
        if (!newGreeting.trim()) return;

        if (greetings.includes(newGreeting.trim())) {
            toast({
                title: "Duplicada",
                description: "Esta saudação já existe na lista.",
                variant: "warning",
            });
            return;
        }

        setGreetings([...greetings, newGreeting.trim()]);
        setNewGreeting("");
    };

    const handleRemoveGreeting = (index: number) => {
        const newGreetings = [...greetings];
        newGreetings.splice(index, 1);
        setGreetings(newGreetings);
    };

    const handleSave = async () => {
        try {
            setLoading(true);
            await api.post("/control-panel", {
                greetingMessages: greetings,
            });

            setOriginalGreetings(greetings);
            toast({
                title: "Sucesso",
                description: "Configurações de saudação salvas com sucesso!",
                variant: "success",
            });
        } catch (error) {
            console.error("Erro ao salvar:", error);
            toast({
                title: "Erro",
                description: "Falha ao salvar as configurações.",
                variant: "destructive",
            });
        } finally {
            setLoading(false);
        }
    };

    const handleReset = () => {
        setGreetings(originalGreetings);
        setNewGreeting("");
        toast({
            title: "Resetado",
            description: "As alterações não salvas foram descartadas.",
        });
    };

    return (
        <MainLayout title="Configuração de Saudações">
            <div className="container mx-auto p-4 max-w-4xl">
                <Card className="mb-6">
                    <CardHeader>
                        <CardTitle className="text-2xl font-bold flex items-center gap-2">
                            <span className="text-2xl">👋</span> Saudações de Campanha
                        </CardTitle>
                        <CardDescription>
                            Configure as mensagens iniciais que serão enviadas aleatoriamente para iniciar conversas nas campanhas.
                            O sistema escolherá uma dessas saudações para enviar primeiro.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="flex gap-4 mb-6">
                            <Input
                                placeholder="Digite uma nova saudação (ex: Olá, tudo bem?)"
                                value={newGreeting}
                                onChange={(e) => setNewGreeting(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && handleAddGreeting()}
                                className="flex-1"
                            />
                            <Button onClick={handleAddGreeting} disabled={!newGreeting.trim()}>
                                <Plus className="mr-2 h-4 w-4" />
                                Adicionar
                            </Button>
                        </div>

                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-medium text-muted-foreground">
                                    Saudações Ativas ({greetings.length})
                                </h3>
                                {greetings.length === 0 && (
                                    <Badge variant="outline" className="text-yellow-600 border-yellow-600">
                                        Nenhuma saudação configurada (Usando padrão do sistema)
                                    </Badge>
                                )}
                            </div>

                            <div className="bg-muted/30 rounded-lg border p-4 min-h-[200px] max-h-[500px] overflow-y-auto">
                                {greetings.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-8">
                                        <p>Nenhuma saudação personalizada.</p>
                                        <p className="text-sm opacity-70 mt-1">O sistema usará as saudações padrão se esta lista estiver vazia.</p>
                                    </div>
                                ) : (
                                    <ul className="space-y-2">
                                        {greetings.map((greeting, index) => (
                                            <li
                                                key={index}
                                                className="flex items-center justify-between bg-card p-3 rounded border shadow-sm group hover:border-primary/50 transition-colors"
                                            >
                                                <span className="text-foreground">{greeting}</span>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleRemoveGreeting(index)}
                                                    className="h-8 w-8 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
                            <Button variant="outline" onClick={handleReset} disabled={loading}>
                                <RotateCcw className="mr-2 h-4 w-4" />
                                Descartar Alterações
                            </Button>
                            <Button onClick={handleSave} disabled={loading} className="bg-green-600 hover:bg-green-700 text-white">
                                <Save className="mr-2 h-4 w-4" />
                                {loading ? "Salvando..." : "Salvar Configurações"}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </MainLayout>
    );
}
