export function GeometricBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
      {/* Circle 1: Sage Green */}
      <div className="absolute -top-[10%] -left-[10%] w-[50vh] h-[50vh] rounded-full bg-primary/20 blur-3xl opacity-60 animate-pulse" 
           style={{ animationDuration: '8s' }} />
      
      {/* Circle 2: Dusty Rose */}
      <div className="absolute top-[20%] -right-[5%] w-[40vh] h-[40vh] rounded-full bg-secondary/20 blur-3xl opacity-60 animate-pulse" 
           style={{ animationDuration: '10s', animationDelay: '1s' }} />
           
      {/* Circle 3: Serenity Blue */}
      <div className="absolute bottom-[10%] left-[20%] w-[60vh] h-[60vh] rounded-full bg-accent/20 blur-3xl opacity-50 animate-pulse" 
           style={{ animationDuration: '12s', animationDelay: '2s' }} />
           
      {/* Circle 4: Muted extra */}
      <div className="absolute -bottom-[10%] -right-[10%] w-[45vh] h-[45vh] rounded-full bg-primary/10 blur-3xl opacity-50" />
    </div>
  );
}
