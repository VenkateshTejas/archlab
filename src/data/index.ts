import type { Domain } from '../types'
import { ticketing } from './ticketing'
import { socialMedia } from './socialMedia'
import { ecommerce } from './ecommerce'
import { betting } from './betting'
import { urlShortener } from './urlShortener'

// The registry. Adding a domain = import it and add it here. Nothing else.
export const domains: Domain[] = [urlShortener, ticketing, socialMedia, ecommerce, betting]
