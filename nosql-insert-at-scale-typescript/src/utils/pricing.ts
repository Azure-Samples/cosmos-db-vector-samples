/**
 * Azure Cosmos DB Pricing Model Comparison Example
 * 
 * This file demonstrates how to use the new pricing calculation functions
 * for Serverless, Standard Provisioned, and Autoscale models.
 */

import { 
  calculateServerlessRUCost,
  calculateAutoscaleRUCost,
  calculateRUCost,
  estimateServerlessMonthlyRUCost,
  estimateAutoscaleMonthlyRUCost,
  estimateMonthlyRUCost,
  compareAllPricingModels
} from './utils.js';

/**
 * Example: Compare pricing models for a sample workload
 */
export function demonstratePricingComparison(): void {
  console.log('🏷️ Azure Cosmos DB Pricing Model Comparison');
  console.log('==========================================');
  
  // Sample workload parameters
  const workloadParams = {
    totalRUs: 5_000_000, // 5 million RUs consumed in a month
    peakRUsPerSecond: 1000, // Peak requirement of 1000 RU/s
    regionCount: 1,
    days: 30
  };

  console.log('\n📊 Workload Parameters:');
  console.log(`   Total RUs consumed: ${workloadParams.totalRUs.toLocaleString()}`);
  console.log(`   Peak RU/s requirement: ${workloadParams.peakRUsPerSecond}`);
  console.log(`   Regions: ${workloadParams.regionCount}`);
  console.log(`   Period: ${workloadParams.days} days`);

  // 1. Serverless calculation
  console.log('\n💰 Serverless Pricing:');
  const serverless = calculateServerlessRUCost({
    totalRUs: workloadParams.totalRUs,
    regionCount: workloadParams.regionCount
  });
  console.log(`   Cost: $${serverless.estimatedCost.toFixed(4)}`);
  console.log(`   ${serverless.description}`);

  // 2. Standard Provisioned calculation
  console.log('\n💰 Standard Provisioned Pricing:');
  const standardProvisioned = calculateRUCost({
    totalRUs: workloadParams.totalRUs,
    isServerless: false,
    provisionedRUs: workloadParams.peakRUsPerSecond,
    days: workloadParams.days,
    regionCount: workloadParams.regionCount
  });
  console.log(`   Cost: $${standardProvisioned.estimatedCost.toFixed(2)}`);
  console.log(`   ${standardProvisioned.description}`);

  // 3. Autoscale calculation
  console.log('\n💰 Autoscale Pricing:');
  const autoscale = calculateAutoscaleRUCost({
    maxAutoscaleRUs: workloadParams.peakRUsPerSecond,
    totalRUsConsumed: workloadParams.totalRUs,
    days: workloadParams.days,
    regionCount: workloadParams.regionCount,
    averageUtilizationPercent: 60 // Assume 60% average utilization
  });
  console.log(`   Cost: $${autoscale.estimatedCost.toFixed(2)}`);
  console.log(`   ${autoscale.description}`);

  // 4. Comprehensive comparison
  console.log('\n🔍 Comprehensive Comparison:');
  const comparison = compareAllPricingModels({
    totalRUs: workloadParams.totalRUs,
    peakRUsPerSecond: workloadParams.peakRUsPerSecond,
    days: workloadParams.days,
    regionCount: workloadParams.regionCount,
    averageAutoscaleUtilization: 60
  });

  console.log(`\n📈 Cost Comparison:`);
  console.log(`   Serverless: $${comparison.serverless.estimatedCost.toFixed(4)}`);
  console.log(`   Standard Provisioned: $${comparison.standardProvisioned.estimatedCost.toFixed(2)}`);
  console.log(`   Autoscale: $${comparison.autoscale.estimatedCost.toFixed(2)}`);
  
  console.log(`\n🏆 Recommendation:`);
  console.log(`   Best option: ${comparison.recommendation.cheapest}`);
  console.log(`   Reason: ${comparison.recommendation.reason}`);
  console.log(`   Savings: ${comparison.recommendation.potentialSavings}`);
}

/**
 * Example: Monthly cost estimation based on current usage
 */
export function demonstrateMonthlyEstimation(): void {
  console.log('\n\n📅 Monthly Cost Estimation Examples');
  console.log('===================================');

  // Sample current usage (e.g., from a 1-hour test run)
  const currentUsage = {
    totalRUs: 50_000, // 50K RUs consumed in 1 hour
    durationMs: 60 * 60 * 1000, // 1 hour in milliseconds
    regionCount: 1
  };

  console.log('\n📊 Current Usage Pattern:');
  console.log(`   RUs consumed: ${currentUsage.totalRUs.toLocaleString()}`);
  console.log(`   Duration: ${currentUsage.durationMs / (60 * 1000)} minutes`);
  console.log(`   Rate: ${(currentUsage.totalRUs / (currentUsage.durationMs / 1000)).toFixed(2)} RU/s`);

  // 1. Serverless monthly estimation
  console.log('\n💰 Serverless Monthly Projection:');
  const serverlessMonthly = estimateServerlessMonthlyRUCost({
    currentTotalRUs: currentUsage.totalRUs,
    durationMs: currentUsage.durationMs,
    regionCount: currentUsage.regionCount
  });
  console.log(`   Projected monthly cost: $${serverlessMonthly.monthlyCost.toFixed(2)}`);
  console.log(`   Projected monthly RUs: ${serverlessMonthly.projectedMonthlyRUs.toLocaleString()}`);

  // 2. Autoscale monthly estimation (assuming we provision for peak + buffer)
  const estimatedPeakRUs = Math.ceil((currentUsage.totalRUs / (currentUsage.durationMs / 1000)) * 1.5); // 50% buffer
  
  console.log('\n💰 Autoscale Monthly Projection:');
  console.log(`   Estimated peak requirement: ${estimatedPeakRUs} RU/s (with 50% buffer)`);
  
  const autoscaleMonthly = estimateAutoscaleMonthlyRUCost({
    currentTotalRUs: currentUsage.totalRUs,
    durationMs: currentUsage.durationMs,
    maxAutoscaleRUs: estimatedPeakRUs,
    regionCount: currentUsage.regionCount,
    averageUtilizationPercent: 40 // Conservative estimate for variable workloads
  });
  console.log(`   Projected monthly cost: $${autoscaleMonthly.monthlyCost.toFixed(2)}`);
  console.log(`   Projected monthly RUs: ${autoscaleMonthly.projectedMonthlyRUs.toLocaleString()}`);

  // 3. Standard provisioned monthly estimation
  console.log('\n💰 Standard Provisioned Monthly Projection:');
  const standardMonthly = estimateMonthlyRUCost({
    currentTotalRUs: currentUsage.totalRUs,
    durationMs: currentUsage.durationMs,
    isServerless: false,
    provisionedRUs: estimatedPeakRUs,
    regionCount: currentUsage.regionCount
  });
  console.log(`   Projected monthly cost: $${standardMonthly.monthlyCost.toFixed(2)}`);
  console.log(`   Projected monthly RUs: ${standardMonthly.projectedMonthlyRUs.toLocaleString()}`);

  // Compare the projections
  const monthlyComparison = [
    { model: 'Serverless', cost: serverlessMonthly.monthlyCost },
    { model: 'Autoscale', cost: autoscaleMonthly.monthlyCost },
    { model: 'Standard Provisioned', cost: standardMonthly.monthlyCost }
  ].sort((a, b) => a.cost - b.cost);

  console.log('\n🏆 Monthly Cost Ranking:');
  monthlyComparison.forEach((option, index) => {
    const rank = index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉';
    console.log(`   ${rank} ${option.model}: $${option.cost.toFixed(2)}`);
  });
}

/**
 * Example: Different workload scenarios
 */
export function demonstrateWorkloadScenarios(): void {
  console.log('\n\n🎯 Workload Scenario Analysis');
  console.log('=============================');

  const scenarios = [
    {
      name: 'Low-traffic blog',
      totalRUs: 500_000, // 500K RUs per month
      peakRUsPerSecond: 50,
      description: 'Small website with occasional traffic spikes'
    },
    {
      name: 'E-commerce during sale',
      totalRUs: 50_000_000, // 50M RUs per month
      peakRUsPerSecond: 5000,
      description: 'High-traffic e-commerce with predictable sale periods'
    },
    {
      name: 'IoT sensor data',
      totalRUs: 20_000_000, // 20M RUs per month
      peakRUsPerSecond: 2000,
      description: 'Steady IoT data ingestion with minimal variance'
    },
    {
      name: 'Social media app',
      totalRUs: 100_000_000, // 100M RUs per month
      peakRUsPerSecond: 8000,
      description: 'Highly variable social media traffic patterns'
    }
  ];

  scenarios.forEach(scenario => {
    console.log(`\n📱 Scenario: ${scenario.name}`);
    console.log(`   Description: ${scenario.description}`);
    console.log(`   Monthly RUs: ${scenario.totalRUs.toLocaleString()}`);
    console.log(`   Peak RU/s: ${scenario.peakRUsPerSecond}`);

    const comparison = compareAllPricingModels({
      totalRUs: scenario.totalRUs,
      peakRUsPerSecond: scenario.peakRUsPerSecond,
      days: 30,
      regionCount: 1
    });

    console.log(`   💰 Costs: Serverless $${comparison.serverless.estimatedCost.toFixed(2)} | ` +
                `Standard $${comparison.standardProvisioned.estimatedCost.toFixed(2)} | ` +
                `Autoscale $${comparison.autoscale.estimatedCost.toFixed(2)}`);
    console.log(`   🏆 Best: ${comparison.recommendation.cheapest} (${comparison.recommendation.potentialSavings})`);
  });
}

// Run examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  demonstratePricingComparison();
  demonstrateMonthlyEstimation();
  demonstrateWorkloadScenarios();
}