/**
 * Test setup for Bun with happy-dom
 *
 * This file is preloaded before tests run to set up the DOM environment.
 */

import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Register happy-dom globals (window, document, etc.)
GlobalRegistrator.register();
