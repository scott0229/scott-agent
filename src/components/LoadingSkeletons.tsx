import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export function ProjectListSkeleton() {
    return (
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
            <div className="p-4 border-b bg-secondary">
                <div className="grid grid-cols-6 gap-4">
                    <Skeleton className="h-4 w-8" />
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-16" />
                </div>
            </div>
            {[...Array(5)].map((_, i) => (
                <div key={i} className="p-4 border-b last:border-0">
                    <div className="grid grid-cols-6 gap-4 items-center">
                        <Skeleton className="h-4 w-8" />
                        <Skeleton className="h-4 w-40" />
                        <Skeleton className="h-6 w-8 rounded-full mx-auto" />
                        <Skeleton className="h-4 w-28" />
                        <Skeleton className="h-4 w-20" />
                        <div className="flex justify-end gap-2">
                            <Skeleton className="h-8 w-8" />
                            <Skeleton className="h-8 w-8" />
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

export function OptionsClientSkeleton() {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
                <Card key={i} className="overflow-hidden">
                    <div className="flex items-center gap-4 p-6">
                        <Skeleton className="h-12 w-12 rounded-full" />
                        <div className="flex-1 space-y-2">
                            <Skeleton className="h-5 w-24" />
                            <Skeleton className="h-4 w-32" />
                        </div>
                    </div>
                    <div className="px-6 pb-6">
                        <Skeleton className="h-4 w-28" />
                    </div>
                </Card>
            ))}
        </div>
    );
}
