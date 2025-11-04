import { CosmosClient } from '@azure/cosmos';
import { promises as fs } from "fs";
import { getClients, getClientsPasswordless } from './cosmos-operations.js';

// Define a type for JSON data
export type JsonData = Record<string, any>;

// Re-export client functions for backward compatibility
export { getClients, getClientsPasswordless };

/**
 * Check if cost estimation should be displayed
 * Set SHOW_COST=true in environment to enable cost display
 */
export function shouldShowCost(): boolean {
  return process.env.SHOW_COST?.toLowerCase() === 'true';
}

export async function readFileReturnJson(filePath: string): Promise<JsonData[]> {

    console.log(`Reading JSON file from ${filePath}`);

    const fileAsString = await fs.readFile(filePath, "utf-8");
    return JSON.parse(fileAsString);
}
export async function writeFileJson(filePath: string, jsonData: JsonData): Promise<void> {
    const jsonString = JSON.stringify(jsonData, null, 2);
    await fs.writeFile(filePath, jsonString, "utf-8");

    console.log(`Wrote JSON file to ${filePath}`);
}
/**
 * Calculate estimated cost for Serverless Azure Cosmos DB
 * 
 * Pricing (as of November 2025):
 * - Serverless: $0.008 per 1 million RUs
 */
export function calculateServerlessRUCost(options: {
  /** Total RUs consumed */
  totalRUs: number;
  /** Price per million RUs for serverless ($0.008 is default) */
  serverlessPricePerMillionRUs?: number;
  /** Number of regions (default: 1) */
  regionCount?: number;
}): {
  /** Estimated cost in USD */
  estimatedCost: number;
  /** Description of the calculation */
  description: string;
  /** Additional details for calculation */
  details: Record<string, any>;
} {
  const {
    totalRUs,
    serverlessPricePerMillionRUs = 0.008,
    regionCount = 1
  } = options;

  // Serverless model: pay per million RUs consumed
  const costPerMillionRUs = serverlessPricePerMillionRUs * regionCount;
  const estimatedCost = (totalRUs / 1_000_000) * costPerMillionRUs;
  
  return {
    estimatedCost,
    description: `Serverless: ${totalRUs.toLocaleString()} RUs = ${(totalRUs / 1_000_000).toFixed(6)} million RUs * $${costPerMillionRUs}/million = $${estimatedCost.toFixed(6)}`,
    details: {
      model: 'Serverless',
      totalRUs,
      costPerMillionRUs,
      regionCount,
      ruPerMillion: totalRUs / 1_000_000
    }
  };
}

/**
 * Calculate estimated cost for Request Units (RUs) in different pricing models
 * 
 * Pricing (as of November 2025):
 * - Serverless: $0.008 per 1 million RUs
 * - Provisioned (General Purpose): $5.84 per 100 RU/s per month
 */
export function calculateRUCost(options: {
  /** Total RUs consumed */
  totalRUs: number;
  /** Whether to use serverless or provisioned pricing model */
  isServerless?: boolean;
  /** RU/s provisioned (only for provisioned model) */
  provisionedRUs?: number;
  /** Price per million RUs for serverless ($0.008 is default) */
  serverlessPricePerMillionRUs?: number;
  /** Price per 100 RU/s per month for provisioned ($5.84 is default for General Purpose) */
  provisionedPricePer100RUsMonth?: number;
  /** Number of days to calculate cost for (default: 30) */
  days?: number;
  /** Number of regions (default: 1) */
  regionCount?: number;
}): {
  /** Estimated cost in USD */
  estimatedCost: number;
  /** Description of the calculation */
  description: string;
  /** Additional details for calculation */
  details: Record<string, any>;
} {
  const {
    totalRUs,
    isServerless = false,
    provisionedRUs = 400, // Minimum is 400 RU/s
    serverlessPricePerMillionRUs = 0.008,
    provisionedPricePer100RUsMonth = 5.84,
    days = 30,
    regionCount = 1
  } = options;

  if (isServerless) {
    return calculateServerlessRUCost({
      totalRUs,
      serverlessPricePerMillionRUs,
      regionCount
    });
  } else {
    // Provisioned model: pay per RU/s provisioned per month
    const rusPer100 = provisionedRUs / 100;
    const monthsInPeriod = days / 30;
    const estimatedCost = rusPer100 * provisionedPricePer100RUsMonth * monthsInPeriod * regionCount;
    
    // Also calculate what the same workload would cost in serverless
    const serverlessCost = (totalRUs / 1_000_000) * serverlessPricePerMillionRUs * regionCount;
    
    return {
      estimatedCost,
      description: `Provisioned: ${provisionedRUs} RU/s = ${rusPer100} x 100 RU/s * $${provisionedPricePer100RUsMonth}/month * ${monthsInPeriod.toFixed(2)} months * ${regionCount} region(s) = $${estimatedCost.toFixed(2)}`,
      details: {
        model: 'Provisioned',
        provisionedRUs,
        rusPer100,
        monthsInPeriod,
        regionCount,
        costPer100RUsMonth: provisionedPricePer100RUsMonth,
        comparisonToServerless: {
          serverlessCost,
          differencePercentage: ((serverlessCost - estimatedCost) / estimatedCost * 100).toFixed(2)
        }
      }
    };
  }
}

/**
 * Calculate estimated cost for Autoscale Azure Cosmos DB
 * 
 * Pricing (as of November 2025):
 * - Autoscale General Purpose: $5.84/month per 100 RU/s 
 * - Autoscale Business Critical: $11.68/month per 100 RU/s  
 * - Scales automatically between 10% of max RU/s and max RU/s based on workload
 */
export function calculateAutoscaleRUCost(options: {
  /** Maximum RU/s configured for autoscale */
  maxAutoscaleRUs: number;
  /** Actual RUs consumed during the period */
  totalRUsConsumed?: number;
  /** Price per 100 RU/s per month for autoscale ($5.84 is default for General Purpose) */
  autoscalePricePer100RUsMonth?: number;
  /** Number of days to calculate cost for (default: 30) */
  days?: number;
  /** Number of regions (default: 1) */
  regionCount?: number;
  /** Average utilization percentage (default: 50% - scales between 10% and 100%) */
  averageUtilizationPercent?: number;
}): {
  /** Estimated cost in USD */
  estimatedCost: number;
  /** Description of the calculation */
  description: string;
  /** Additional details for calculation */
  details: Record<string, any>;
} {
  const {
    maxAutoscaleRUs,
    totalRUsConsumed,
    autoscalePricePer100RUsMonth = 5.84, // General Purpose base price per month
    days = 30,
    regionCount = 1,
    averageUtilizationPercent = 50 // Default assumption for scaling behavior
  } = options;

  // Autoscale billing is based on the highest RU/s reached in each hour
  // For estimation purposes, we'll use average utilization
  const averageRUs = maxAutoscaleRUs * (averageUtilizationPercent / 100);
  const rusPer100 = averageRUs / 100;
  const monthsInPeriod = days / 30;
  const estimatedCost = rusPer100 * autoscalePricePer100RUsMonth * monthsInPeriod * regionCount;
  
  // Compare with standard provisioned and serverless if RU consumption is provided
  let comparisons: Record<string, any> = {};
  if (totalRUsConsumed) {
    const serverlessCost = calculateServerlessRUCost({
      totalRUs: totalRUsConsumed,
      regionCount
    });
    
    const standardProvisionedCost = rusPer100 * 5.84 * monthsInPeriod * regionCount; // General Purpose standard rate per month
    
    comparisons = {
      serverless: {
        cost: serverlessCost.estimatedCost,
        savings: ((estimatedCost - serverlessCost.estimatedCost) / estimatedCost * 100).toFixed(2)
      },
      standardProvisioned: {
        cost: standardProvisionedCost,
        savings: ((estimatedCost - standardProvisionedCost) / estimatedCost * 100).toFixed(2)
      }
    };
  }

  return {
    estimatedCost,
    description: `Autoscale: Max ${maxAutoscaleRUs} RU/s (avg ~${averageRUs} RU/s at ${averageUtilizationPercent}% utilization) = ${rusPer100.toFixed(2)} x 100 RU/s * $${autoscalePricePer100RUsMonth}/month * ${monthsInPeriod.toFixed(2)} months * ${regionCount} region(s) = $${estimatedCost.toFixed(2)}`,
    details: {
      model: 'Autoscale',
      maxAutoscaleRUs,
      averageRUs,
      averageUtilizationPercent,
      rusPer100,
      monthsInPeriod,
      regionCount,
      costPer100RUsMonth: autoscalePricePer100RUsMonth,
      comparisons
    }
  };
}

/**
 * Estimate monthly cost for Serverless Azure Cosmos DB based on current usage pattern
 */
export function estimateServerlessMonthlyRUCost(options: {
  /** Current total RUs consumed */
  currentTotalRUs: number;
  /** Duration in milliseconds over which the RUs were consumed */
  durationMs: number;
  /** Price per million RUs for serverless */
  serverlessPricePerMillionRUs?: number;
  /** Number of regions */
  regionCount?: number;
}): {
  /** Estimated monthly cost in USD */
  monthlyCost: number;
  /** Projected RU consumption for a month */
  projectedMonthlyRUs: number;
  /** Detailed breakdown of the calculation */
  details: Record<string, any>;
} {
  const {
    currentTotalRUs,
    durationMs,
    serverlessPricePerMillionRUs = 0.008,
    regionCount = 1
  } = options;

  // Calculate projected monthly RU usage based on current consumption rate
  const msInMonth = 30 * 24 * 60 * 60 * 1000;
  const projectedMonthlyRUs = currentTotalRUs * (msInMonth / durationMs);

  // Calculate cost using the serverless calculation function
  const costCalculation = calculateServerlessRUCost({
    totalRUs: projectedMonthlyRUs,
    serverlessPricePerMillionRUs,
    regionCount
  });

  return {
    monthlyCost: costCalculation.estimatedCost,
    projectedMonthlyRUs,
    details: {
      ...costCalculation.details,
      currentRate: {
        ruPerSecond: (currentTotalRUs / (durationMs / 1000)).toFixed(2),
        ruPerMinute: (currentTotalRUs / (durationMs / 60000)).toFixed(2),
        ruPerHour: (currentTotalRUs / (durationMs / 3600000)).toFixed(2),
        durationMs,
        currentTotalRUs
      },
      projectionBasis: `Projected ${(projectedMonthlyRUs / 1_000_000).toFixed(2)} million RUs/month based on current rate`
    }
  };
}

/**
 * Estimate monthly cost for Autoscale Azure Cosmos DB based on current usage pattern
 */
export function estimateAutoscaleMonthlyRUCost(options: {
  /** Current total RUs consumed */
  currentTotalRUs: number;
  /** Duration in milliseconds over which the RUs were consumed */
  durationMs: number;
  /** Maximum RU/s that would be configured for autoscale */
  maxAutoscaleRUs: number;
  /** Price per 100 RU/s per month for autoscale */
  autoscalePricePer100RUsMonth?: number;
  /** Number of regions */
  regionCount?: number;
  /** Expected average utilization percentage */
  averageUtilizationPercent?: number;
}): {
  /** Estimated monthly cost in USD */
  monthlyCost: number;
  /** Projected RU consumption for a month */
  projectedMonthlyRUs: number;
  /** Detailed breakdown of the calculation */
  details: Record<string, any>;
} {
  const {
    currentTotalRUs,
    durationMs,
    maxAutoscaleRUs,
    autoscalePricePer100RUsMonth = 5.84,
    regionCount = 1,
    averageUtilizationPercent = 50
  } = options;

  // Calculate projected monthly RU usage based on current consumption rate
  const msInMonth = 30 * 24 * 60 * 60 * 1000;
  const projectedMonthlyRUs = currentTotalRUs * (msInMonth / durationMs);

  // Calculate cost using the autoscale calculation function
  const costCalculation = calculateAutoscaleRUCost({
    maxAutoscaleRUs,
    totalRUsConsumed: projectedMonthlyRUs,
    autoscalePricePer100RUsMonth,
    regionCount,
    averageUtilizationPercent
  });

  return {
    monthlyCost: costCalculation.estimatedCost,
    projectedMonthlyRUs,
    details: {
      ...costCalculation.details,
      currentRate: {
        ruPerSecond: (currentTotalRUs / (durationMs / 1000)).toFixed(2),
        ruPerMinute: (currentTotalRUs / (durationMs / 60000)).toFixed(2),
        ruPerHour: (currentTotalRUs / (durationMs / 3600000)).toFixed(2),
        durationMs,
        currentTotalRUs
      },
      projectionBasis: `Projected ${(projectedMonthlyRUs / 1_000_000).toFixed(2)} million RUs/month based on current rate`
    }
  };
}

/**
 * Estimate monthly cost based on current RU usage pattern (backward compatibility)
 */
export function estimateMonthlyRUCost(options: {
  /** Current total RUs consumed */
  currentTotalRUs: number;
  /** Duration in milliseconds over which the RUs were consumed */
  durationMs: number;
  /** Whether the account is serverless */
  isServerless?: boolean;
  /** If provisioned, the current RU/s setting */
  provisionedRUs?: number;
  /** Price per million RUs for serverless */
  serverlessPricePerMillionRUs?: number;
  /** Price per 100 RU/s per month for provisioned */
  provisionedPricePer100RUsMonth?: number;
  /** Number of regions */
  regionCount?: number;
}): {
  /** Estimated monthly cost in USD */
  monthlyCost: number;
  /** Projected RU consumption for a month */
  projectedMonthlyRUs: number;
  /** Detailed breakdown of the calculation */
  details: Record<string, any>;
} {
  const {
    currentTotalRUs,
    durationMs,
    isServerless = false,
    provisionedRUs = 400,
    serverlessPricePerMillionRUs = 0.008,
    provisionedPricePer100RUsMonth = 5.84,
    regionCount = 1
  } = options;

  // Calculate projected monthly RU usage based on current consumption rate
  const msInMonth = 30 * 24 * 60 * 60 * 1000;
  const projectedMonthlyRUs = currentTotalRUs * (msInMonth / durationMs);

  // Calculate cost using the RU calculation function
  const costCalculation = calculateRUCost({
    totalRUs: projectedMonthlyRUs,
    isServerless,
    provisionedRUs,
    serverlessPricePerMillionRUs,
    provisionedPricePer100RUsMonth,
    regionCount
  });

  return {
    monthlyCost: costCalculation.estimatedCost,
    projectedMonthlyRUs,
    details: {
      ...costCalculation.details,
      currentRate: {
        ruPerSecond: (currentTotalRUs / (durationMs / 1000)).toFixed(2),
        ruPerMinute: (currentTotalRUs / (durationMs / 60000)).toFixed(2),
        ruPerHour: (currentTotalRUs / (durationMs / 3600000)).toFixed(2),
        durationMs,
        currentTotalRUs
      },
      projectionBasis: `Projected ${(projectedMonthlyRUs / 1_000_000).toFixed(2)} million RUs/month based on current rate`
    }
  };
}

/**
 * Compare costs across all Azure Cosmos DB pricing models
 */
export function compareAllPricingModels(options: {
  /** Total RUs consumed */
  totalRUs: number;
  /** Peak RU/s requirement for provisioned/autoscale sizing */
  peakRUsPerSecond: number;
  /** Duration for the workload in days (default: 30) */
  days?: number;
  /** Number of regions (default: 1) */
  regionCount?: number;
  /** Average utilization percentage for autoscale (default: 50%) */
  averageAutoscaleUtilization?: number;
}): {
  /** Serverless cost analysis */
  serverless: ReturnType<typeof calculateServerlessRUCost>;
  /** Standard provisioned cost analysis */
  standardProvisioned: ReturnType<typeof calculateRUCost>;
  /** Autoscale cost analysis */
  autoscale: ReturnType<typeof calculateAutoscaleRUCost>;
  /** Recommendation based on cost */
  recommendation: {
    cheapest: 'serverless' | 'standardProvisioned' | 'autoscale';
    reason: string;
    potentialSavings: string;
  };
} {
  const {
    totalRUs,
    peakRUsPerSecond,
    days = 30,
    regionCount = 1,
    averageAutoscaleUtilization = 50
  } = options;

  // Calculate costs for each model
  const serverless = calculateServerlessRUCost({
    totalRUs,
    regionCount
  });

  const standardProvisioned = calculateRUCost({
    totalRUs,
    isServerless: false,
    provisionedRUs: peakRUsPerSecond,
    days,
    regionCount
  });

  const autoscale = calculateAutoscaleRUCost({
    maxAutoscaleRUs: peakRUsPerSecond,
    totalRUsConsumed: totalRUs,
    days,
    regionCount,
    averageUtilizationPercent: averageAutoscaleUtilization
  });

  // Determine the cheapest option
  const costs = {
    serverless: serverless.estimatedCost,
    standardProvisioned: standardProvisioned.estimatedCost,
    autoscale: autoscale.estimatedCost
  };

  const cheapest = Object.keys(costs).reduce((a, b) => 
    costs[a as keyof typeof costs] < costs[b as keyof typeof costs] ? a : b
  ) as keyof typeof costs;

  const sortedCosts = Object.entries(costs).sort(([,a], [,b]) => a - b);
  const [cheapestModel, cheapestCost] = sortedCosts[0];
  const [, secondCheapestCost] = sortedCosts[1];
  const savings = ((secondCheapestCost - cheapestCost) / secondCheapestCost * 100).toFixed(1);

  let reason = '';
  if (cheapest === 'serverless') {
    reason = 'Serverless is most cost-effective for low to moderate, intermittent workloads';
  } else if (cheapest === 'standardProvisioned') {
    reason = 'Standard provisioned is most cost-effective for predictable, sustained workloads';
  } else {
    reason = 'Autoscale is most cost-effective for variable workloads with unpredictable traffic patterns';
  }

  return {
    serverless,
    standardProvisioned,
    autoscale,
    recommendation: {
      cheapest,
      reason,
      potentialSavings: `${savings}% savings compared to next best option`
    }
  };
}
