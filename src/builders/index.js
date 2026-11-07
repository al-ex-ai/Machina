// Register every builder here. Models pick one with their "builder" field.
import { registerBuilder } from '../registry.js';
import { buildFixedWing } from './fixed-wing.js';

registerBuilder('fixed-wing', 'Fixed-wing aircraft', buildFixedWing);
