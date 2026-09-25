import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";

export default function SettingsPanelSkeleton() {
  return (
    <SkeletonTheme baseColor="#F0F0F0" highlightColor="#F9F9F9">
      <div className="rounded-2xl border border-[#E8E8E8] bg-white p-8 flex flex-col gap-8">
        <div>
          <Skeleton width={180} height={20} borderRadius={6} />
          <div className="mt-2">
            <Skeleton width={260} height={14} borderRadius={4} />
          </div>
        </div>
        <Skeleton height={120} borderRadius={12} />
        <div className="flex flex-col gap-3">
          <Skeleton height={44} borderRadius={12} />
          <Skeleton height={44} borderRadius={12} />
        </div>
      </div>
    </SkeletonTheme>
  );
}
