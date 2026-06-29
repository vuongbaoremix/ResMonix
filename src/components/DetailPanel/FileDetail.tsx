import { useDiskStore } from "@/store/useDiskStore";
import {
  formatSize,
  formatDate,
  formatNumber,
  getRiskLabel,
  getRiskVariant,
} from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Folder,
  File,
  Trash2,
  Info,
  Shield,
  Link,
  Lock,
  ExternalLink,
} from "lucide-react";

export function FileDetail() {
  const { selectedNode, fileDescription, openInExplorer, deleteItem } =
    useDiskStore();

  if (!selectedNode) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm p-4">
        <div className="text-center space-y-2">
          <Info className="h-8 w-8 mx-auto opacity-20" />
          <p>Chọn file hoặc thư mục</p>
          <p className="text-xs">để xem thông tin chi tiết</p>
        </div>
      </div>
    );
  }

  const isDir = selectedNode.node_type === "directory";

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-3">
        {/* Header */}
        <div className="space-y-1.5">
          <div className="flex items-start gap-2">
            {selectedNode.access_denied ? (
              <Lock className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            ) : isDir ? (
              <Folder className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />
            ) : selectedNode.node_type === "symlink" ||
              selectedNode.node_type === "junction" ? (
              <Link className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
            ) : (
              <File className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
            )}
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-sm truncate">
                {selectedNode.name}
              </h3>
              <p className="text-[11px] text-muted-foreground truncate">
                {selectedNode.path}
              </p>
            </div>
          </div>

          {/* Risk badge */}
          <Badge variant={getRiskVariant(selectedNode.risk_level)} className="text-xs">
            {getRiskLabel(selectedNode.risk_level)}
          </Badge>
        </div>

        <Separator />

        {/* Info grid */}
        <div className="grid grid-cols-2 gap-y-2 gap-x-3 text-xs">
          <div>
            <p className="text-muted-foreground">Dung lượng</p>
            <p className="font-medium">{formatSize(selectedNode.size)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Loại</p>
            <p className="font-medium capitalize">{selectedNode.node_type}</p>
          </div>
          {isDir && (
            <>
              <div>
                <p className="text-muted-foreground">Số file</p>
                <p className="font-medium">
                  {formatNumber(selectedNode.file_count)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Số thư mục</p>
                <p className="font-medium">
                  {formatNumber(selectedNode.dir_count)}
                </p>
              </div>
            </>
          )}
          <div className="col-span-2">
            <p className="text-muted-foreground">Chỉnh sửa lần cuối</p>
            <p className="font-medium">
              {formatDate(selectedNode.last_modified)}
            </p>
          </div>
        </div>

        {/* File description (from knowledge base) */}
        {fileDescription && (
          <>
            <Separator />
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-medium">
                  {fileDescription.what}
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {fileDescription.description}
              </p>
              <div className="text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Thuộc về:</span>
                  <span className="font-medium">
                    {fileDescription.belongs_to}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Quan trọng:</span>
                  <span className="font-medium">
                    {fileDescription.importance}
                  </span>
                </div>
              </div>
            </div>
          </>
        )}

        {selectedNode.access_denied && (
          <>
            <Separator />
            <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
              ⚠️ Không có quyền truy cập. Chạy ứng dụng với quyền Administrator
              để xem nội dung.
            </div>
          </>
        )}

        <Separator />

        {/* Actions */}
        <div className="space-y-1.5">
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2 text-xs"
            onClick={() => openInExplorer(selectedNode.path)}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Mở trong Explorer
          </Button>

          {selectedNode.risk_level !== "dangerous" && !selectedNode.access_denied && (
            <Button
              variant="destructive"
              size="sm"
              className="w-full justify-start gap-2 text-xs"
              onClick={() => {
                if (
                  window.confirm(
                    `Bạn có chắc muốn xóa "${selectedNode.name}"?\nDung lượng: ${formatSize(selectedNode.size)}`
                  )
                ) {
                  deleteItem(selectedNode.path, false);
                }
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Xóa (vào Recycle Bin)
            </Button>
          )}

          {selectedNode.risk_level === "dangerous" && (
            <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
              🔴 File/thư mục hệ thống quan trọng. Không nên xóa.
            </div>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}
