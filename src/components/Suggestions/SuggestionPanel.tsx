import { useDiskStore } from "@/store/useDiskStore";
import { formatSize, getRiskVariant } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Lightbulb,
  Trash2,
  Terminal,
  Settings,
  Package,
  MoveRight,
  Sparkles,
} from "lucide-react";
import type { ActionType } from "@/types";

function getActionIcon(type: ActionType) {
  switch (type) {
    case "direct_delete":
      return <Trash2 className="h-4 w-4" />;
    case "tool_required":
      return <Terminal className="h-4 w-4" />;
    case "config_change":
      return <Settings className="h-4 w-4" />;
    case "reinstallable":
      return <Package className="h-4 w-4" />;
    case "move_to_other_drive":
      return <MoveRight className="h-4 w-4" />;
  }
}

function getActionLabel(type: ActionType): string {
  switch (type) {
    case "direct_delete":
      return "Xóa trực tiếp";
    case "tool_required":
      return "Cần dùng công cụ";
    case "config_change":
      return "Thay đổi cấu hình";
    case "reinstallable":
      return "Có thể cài lại";
    case "move_to_other_drive":
      return "Di chuyển sang ổ khác";
  }
}

export function SuggestionPanel() {
  const { suggestions } = useDiskStore();

  const totalSavings = suggestions.reduce(
    (sum, s) => sum + s.estimated_savings,
    0
  );

  if (suggestions.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        <div className="text-center space-y-2">
          <Lightbulb className="h-12 w-12 mx-auto opacity-20" />
          <p>Quét ổ đĩa để nhận đề xuất</p>
          <p className="text-xs">tối ưu dung lượng</p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        {/* Summary header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="font-semibold text-sm">Đề xuất tối ưu</h2>
          </div>
          <Badge variant="secondary" className="text-xs">
            Có thể giải phóng {formatSize(totalSavings)}
          </Badge>
        </div>

        <Separator />

        {/* Suggestion cards */}
        <div className="space-y-3">
          {suggestions.map((suggestion, index) => (
            <Card key={index} className="overflow-hidden">
              <CardHeader className="p-3 pb-2">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    {getActionIcon(suggestion.action_type)}
                    {suggestion.title}
                  </CardTitle>
                  <Badge
                    variant={getRiskVariant(suggestion.risk_level as any)}
                    className="text-[10px] shrink-0"
                  >
                    {formatSize(suggestion.estimated_savings)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-3 pt-0 space-y-2">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {suggestion.description}
                </p>

                <div className="flex items-center gap-2 text-[11px]">
                  <Badge variant="outline" className="text-[10px]">
                    {getActionLabel(suggestion.action_type)}
                  </Badge>
                  <span className="text-muted-foreground">
                    {suggestion.category}
                  </span>
                </div>

                {suggestion.command && (
                  <div className="bg-muted rounded-md px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                    $ {suggestion.command}
                  </div>
                )}

                {suggestion.paths.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                      {suggestion.paths.length} đường dẫn
                    </summary>
                    <ul className="mt-1 space-y-0.5 max-h-24 overflow-y-auto">
                      {suggestion.paths.slice(0, 10).map((path, i) => (
                        <li
                          key={i}
                          className="text-[11px] text-muted-foreground truncate"
                        >
                          {path}
                        </li>
                      ))}
                      {suggestion.paths.length > 10 && (
                        <li className="text-[11px] text-muted-foreground">
                          ... và {suggestion.paths.length - 10} đường dẫn khác
                        </li>
                      )}
                    </ul>
                  </details>
                )}

                {suggestion.action_type === "direct_delete" && (
                  <Button
                    variant="destructive"
                    size="sm"
                    className="w-full text-xs gap-1.5 mt-1"
                  >
                    <Trash2 className="h-3 w-3" />
                    Dọn dẹp
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}
