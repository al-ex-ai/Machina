// Register every builder here. Models pick one with their "builder" field.
import { registerBuilder } from '../registry.js';
import { buildFixedWing } from './fixed-wing.js';
import { buildRotorcraft } from './rotorcraft.js';
import { buildTracked } from './tracked.js';
import { buildParametric } from './parametric.js';

registerBuilder('fixed-wing', 'Fixed-wing aircraft', buildFixedWing);
registerBuilder('rotorcraft', 'Helicopter', buildRotorcraft);
registerBuilder('tracked', 'Tracked vehicle', buildTracked);
registerBuilder('parametric', 'Parametric aircraft', buildParametric);
