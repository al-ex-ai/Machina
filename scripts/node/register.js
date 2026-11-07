// Lets Node resolve the bare "three" import the same way the browser import map does.
import { register } from 'node:module';

register('./three-resolver.js', import.meta.url);
