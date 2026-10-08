import { createContext } from 'react'

/**
 * The level of a settings card's title; a subsection's title is one below it.
 * Cards are h2 under a wizard step's h1. The Admin panel's Server tab puts
 * them under its section headings (h2), so it sets 3.
 */
export const CardHeadingLevel = createContext<2 | 3>(2)
