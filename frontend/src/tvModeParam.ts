// Side-effect module: main.tsx imports it before the router, so ?tv=1 / ?tv=0
// is stored and stripped before anything reads TV mode or the URL. The router
// captures the address when it is created, and the install store checks TV
// mode when it loads; both happen while main.tsx's imports are evaluated,
// before any code in main.tsx itself would run.
import { applyTVModeQueryParam } from '@/hooks/useTVMode'

applyTVModeQueryParam()
