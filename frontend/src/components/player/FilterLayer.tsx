import { RetroTVFilter } from '@/components/filters/RetroTVFilter'
import { FilmGrainFilter } from '@/components/filters/FilmGrainFilter'
import { NoirFilter } from '@/components/filters/NoirFilter'
import { GrindhouseFilter } from '@/components/filters/GrindhouseFilter'
import { SportsHDFilter } from '@/components/filters/SportsHDFilter'
import { useFilterStore } from '@/stores/filterStore'

/**
 * The video filter overlays, rendered once in the player shell for whichever
 * engine is playing. The shell renders this before the engine: nothing
 * between them creates a stacking context, so the engine's z-10 control bar
 * paints above these z-10 filters only if it comes later in the DOM.
 */
export function FilterLayer() {
  const isRetroTVActive = useFilterStore((s) => s.isFilterActive('retro-tv'))
  const isFilmGrainActive = useFilterStore((s) => s.isFilterActive('film-grain'))
  const isNoirActive = useFilterStore((s) => s.isFilterActive('noir'))
  const isGrindhouseActive = useFilterStore((s) => s.isFilterActive('grindhouse'))
  const isSportsHDActive = useFilterStore((s) => s.isFilterActive('sports-hd'))

  return (
    <>
      <RetroTVFilter isActive={isRetroTVActive} />
      <FilmGrainFilter isActive={isFilmGrainActive} />
      <NoirFilter isActive={isNoirActive} />
      <GrindhouseFilter isActive={isGrindhouseActive} />
      <SportsHDFilter isActive={isSportsHDActive} />
    </>
  )
}
