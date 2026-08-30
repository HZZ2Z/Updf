export type LaunchStep = "install" | "build" | "start" | "open";

export function createLaunchPlan(options: {
  serverRunning: boolean;
  dependenciesInstalled: boolean;
  buildRequired: boolean;
}): LaunchStep[];

export function needsProductionBuild(rootDir: string): Promise<boolean>;
