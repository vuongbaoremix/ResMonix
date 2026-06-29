import { useDiskStore } from "@/store/useDiskStore";
import { formatSize } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { HardDrive, Usb, Network, Disc } from "lucide-react";

function getDriveIcon(driveType: string) {
  switch (driveType) {
    case "Fixed":
      return <HardDrive className="h-8 w-8" />;
    case "Removable":
      return <Usb className="h-8 w-8" />;
    case "Network":
      return <Network className="h-8 w-8" />;
    case "CD-ROM":
      return <Disc className="h-8 w-8" />;
    default:
      return <HardDrive className="h-8 w-8" />;
  }
}

export function DriveSelector() {
  const { drives, selectedDrive, selectDrive, startScan } = useDiskStore();

  if (drives.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">Đang tải danh sách ổ đĩa...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full p-8">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold mb-2">ResMonix</h1>
        <p className="text-muted-foreground text-sm">
          Chọn ổ đĩa để bắt đầu phân tích
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 max-w-xl w-full">
        {drives.map((drive) => {
          const isSelected = selectedDrive === drive.mount_point;
          return (
            <Card
              key={drive.mount_point}
              className={`cursor-pointer transition-all hover:shadow-md ${
                isSelected
                  ? "ring-2 ring-primary shadow-lg"
                  : "hover:ring-1 hover:ring-border"
              }`}
              onClick={() => {
                selectDrive(drive.mount_point);
                startScan(drive.mount_point);
              }}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="text-primary/60">
                    {getDriveIcon(drive.drive_type)}
                  </div>
                  <div className="flex-1 min-w-0 space-y-2">
                    <div>
                      <h3 className="font-semibold text-sm truncate">
                        {drive.label}
                      </h3>
                      <p className="text-[11px] text-muted-foreground">
                        {drive.file_system} • {drive.drive_type}
                      </p>
                    </div>

                    {/* Usage bar */}
                    <div className="space-y-1">
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{
                            width: `${drive.usage_percent}%`,
                            backgroundColor:
                              drive.usage_percent > 90
                                ? "oklch(0.63 0.24 25)"
                                : drive.usage_percent > 70
                                  ? "oklch(0.75 0.18 75)"
                                  : "oklch(0.65 0.19 250)",
                          }}
                        />
                      </div>
                      <div className="flex justify-between text-[11px] text-muted-foreground">
                        <span>
                          {formatSize(drive.used_space)} đã dùng
                        </span>
                        <span>
                          {formatSize(drive.free_space)} trống
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
