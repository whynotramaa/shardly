#!/bin/bash
# Experiment 1: distance sweep, 5 RNG runs per point
echo "dist,interf,run,pTx,pRx,pdr,thr,delay,iTx,iRx,ipdr,ithr,retries,finalFail" > dist.csv
for r in 1 2 3 4 5; do ./wifi-interference --interf=0 --run=$r | grep CSV | cut -d, -f2- >> dist.csv; done
for d in $(seq 0 5 150); do
  for r in 1 2 3 4 5; do
    ./wifi-interference --interfDist=$d --run=$r | grep CSV | cut -d, -f2- >> dist.csv &
  done; wait
done
# Experiment 2: interferer load sweep at three representative distances
echo "dist,interval,run,pTx,pRx,pdr,thr,delay,iTx,iRx,ipdr,ithr,retries,finalFail" > load.csv
for d in 20 70 120; do for it in 0.016 0.008 0.004 0.003 0.002 0.0015 0.001; do
  for r in 1 2 3; do
    (./wifi-interference --interfDist=$d --interfInt=$it --run=$r | grep CSV | cut -d, -f2- | awk -F, -v it=$it 'BEGIN{OFS=","}{$2=it; print}') >> load.csv &
  done; wait
done; done
