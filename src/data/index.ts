import type { Domain } from '../types'
import { ticketing } from './ticketing'
import { socialMedia } from './socialMedia'
import { ecommerce } from './ecommerce'
import { betting } from './betting'

// The registry. Adding a domain = import it and add it here. Nothing else.
export const domains: Domain[] = [ticketing, socialMedia, ecommerce, betting]
