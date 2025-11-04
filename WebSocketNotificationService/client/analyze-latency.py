#!/usr/bin/env python3
"""
Latency Analysis Script

This script analyzes the CSV output from the load test script and generates:
- Statistical summary
- Latency distribution histogram
- Comparison charts (A2P vs P2P)
- Time-series latency plot

Usage:
    python analyze-latency.py a2p-latency-*.csv p2p-latency-*.csv

Requirements:
    pip install pandas matplotlib numpy
"""

import sys
import pandas as pd
import matplotlib.pyplot as plt
import numpy as np
from pathlib import Path

def load_latency_data(filepath):
    """Load latency data from CSV file"""
    try:
        df = pd.read_csv(filepath)
        return df
    except Exception as e:
        print(f"❌ Error loading {filepath}: {e}")
        return None

def print_statistics(df, name):
    """Print statistical summary of latency data"""
    print(f"\n{'='*70}")
    print(f"📊 {name} - Statistical Summary")
    print(f"{'='*70}")
    
    latencies = df['Latency (ms)']
    
    print(f"Count:      {len(latencies)}")
    print(f"Mean:       {latencies.mean():.2f} ms")
    print(f"Median:     {latencies.median():.2f} ms")
    print(f"Std Dev:    {latencies.std():.2f} ms")
    print(f"Min:        {latencies.min():.2f} ms")
    print(f"Max:        {latencies.max():.2f} ms")
    print(f"\nPercentiles:")
    print(f"  P50:      {latencies.quantile(0.50):.2f} ms")
    print(f"  P75:      {latencies.quantile(0.75):.2f} ms")
    print(f"  P90:      {latencies.quantile(0.90):.2f} ms")
    print(f"  P95:      {latencies.quantile(0.95):.2f} ms")
    print(f"  P99:      {latencies.quantile(0.99):.2f} ms")
    
    # Latency buckets
    print(f"\nLatency Distribution:")
    buckets = [
        (0, 100, "< 100ms"),
        (100, 200, "100-200ms"),
        (200, 500, "200-500ms"),
        (500, 1000, "500-1000ms"),
        (1000, float('inf'), "> 1000ms")
    ]
    
    for min_lat, max_lat, label in buckets:
        count = len(latencies[(latencies >= min_lat) & (latencies < max_lat)])
        percentage = (count / len(latencies)) * 100
        bar = '█' * int(percentage / 2)
        print(f"  {label:12s}: {count:5d} ({percentage:5.1f}%) {bar}")

def plot_histogram(df, name, filename, color='blue'):
    """Plot latency histogram"""
    plt.figure(figsize=(10, 6))
    
    latencies = df['Latency (ms)']
    
    plt.hist(latencies, bins=50, alpha=0.7, color=color, edgecolor='black')
    plt.axvline(latencies.mean(), color='red', linestyle='--', linewidth=2, label=f'Mean: {latencies.mean():.2f}ms')
    plt.axvline(latencies.median(), color='green', linestyle='--', linewidth=2, label=f'Median: {latencies.median():.2f}ms')
    plt.axvline(latencies.quantile(0.95), color='orange', linestyle='--', linewidth=2, label=f'P95: {latencies.quantile(0.95):.2f}ms')
    
    plt.xlabel('Latency (ms)', fontsize=12)
    plt.ylabel('Frequency', fontsize=12)
    plt.title(f'{name} - Latency Distribution', fontsize=14, fontweight='bold')
    plt.legend()
    plt.grid(True, alpha=0.3)
    
    plt.tight_layout()
    plt.savefig(filename, dpi=300)
    print(f"📁 Saved histogram: {filename}")
    plt.close()

def plot_comparison(a2p_df, p2p_df, filename):
    """Plot A2P vs P2P comparison"""
    fig, axes = plt.subplots(2, 2, figsize=(14, 10))
    
    # 1. Histogram comparison
    ax1 = axes[0, 0]
    ax1.hist(a2p_df['Latency (ms)'], bins=50, alpha=0.5, label='A2P', color='blue', edgecolor='black')
    ax1.hist(p2p_df['Latency (ms)'], bins=50, alpha=0.5, label='P2P', color='orange', edgecolor='black')
    ax1.set_xlabel('Latency (ms)')
    ax1.set_ylabel('Frequency')
    ax1.set_title('Latency Distribution Comparison')
    ax1.legend()
    ax1.grid(True, alpha=0.3)
    
    # 2. Box plot comparison
    ax2 = axes[0, 1]
    ax2.boxplot(
        [a2p_df['Latency (ms)'], p2p_df['Latency (ms)']],
        labels=['A2P', 'P2P'],
        patch_artist=True,
        boxprops=dict(facecolor='lightblue', alpha=0.7),
        medianprops=dict(color='red', linewidth=2)
    )
    ax2.set_ylabel('Latency (ms)')
    ax2.set_title('Latency Box Plot Comparison')
    ax2.grid(True, alpha=0.3)
    
    # 3. CDF (Cumulative Distribution Function)
    ax3 = axes[1, 0]
    
    a2p_sorted = np.sort(a2p_df['Latency (ms)'])
    a2p_cdf = np.arange(1, len(a2p_sorted) + 1) / len(a2p_sorted)
    ax3.plot(a2p_sorted, a2p_cdf * 100, label='A2P', color='blue', linewidth=2)
    
    p2p_sorted = np.sort(p2p_df['Latency (ms)'])
    p2p_cdf = np.arange(1, len(p2p_sorted) + 1) / len(p2p_sorted)
    ax3.plot(p2p_sorted, p2p_cdf * 100, label='P2P', color='orange', linewidth=2)
    
    ax3.axhline(95, color='red', linestyle='--', alpha=0.5, label='P95')
    ax3.axhline(99, color='darkred', linestyle='--', alpha=0.5, label='P99')
    
    ax3.set_xlabel('Latency (ms)')
    ax3.set_ylabel('Percentile (%)')
    ax3.set_title('Cumulative Distribution Function (CDF)')
    ax3.legend()
    ax3.grid(True, alpha=0.3)
    
    # 4. Statistical comparison bars
    ax4 = axes[1, 1]
    
    metrics = ['Mean', 'Median', 'P95', 'P99']
    a2p_values = [
        a2p_df['Latency (ms)'].mean(),
        a2p_df['Latency (ms)'].median(),
        a2p_df['Latency (ms)'].quantile(0.95),
        a2p_df['Latency (ms)'].quantile(0.99)
    ]
    p2p_values = [
        p2p_df['Latency (ms)'].mean(),
        p2p_df['Latency (ms)'].median(),
        p2p_df['Latency (ms)'].quantile(0.95),
        p2p_df['Latency (ms)'].quantile(0.99)
    ]
    
    x = np.arange(len(metrics))
    width = 0.35
    
    ax4.bar(x - width/2, a2p_values, width, label='A2P', color='blue', alpha=0.7)
    ax4.bar(x + width/2, p2p_values, width, label='P2P', color='orange', alpha=0.7)
    
    ax4.set_xlabel('Metric')
    ax4.set_ylabel('Latency (ms)')
    ax4.set_title('Key Metrics Comparison')
    ax4.set_xticks(x)
    ax4.set_xticklabels(metrics)
    ax4.legend()
    ax4.grid(True, alpha=0.3, axis='y')
    
    plt.tight_layout()
    plt.savefig(filename, dpi=300)
    print(f"📁 Saved comparison chart: {filename}")
    plt.close()

def plot_time_series(df, name, filename, color='blue'):
    """Plot latency over time"""
    plt.figure(figsize=(12, 6))
    
    # Sort by timestamp
    df_sorted = df.sort_values('Timestamp')
    
    # Calculate relative time (seconds from start)
    start_time = df_sorted['Timestamp'].min()
    df_sorted['Relative Time (s)'] = (df_sorted['Timestamp'] - start_time) / 1000
    
    plt.scatter(df_sorted['Relative Time (s)'], df_sorted['Latency (ms)'], 
                alpha=0.3, s=10, color=color)
    
    # Add moving average
    window = 50
    if len(df_sorted) >= window:
        moving_avg = df_sorted['Latency (ms)'].rolling(window=window).mean()
        plt.plot(df_sorted['Relative Time (s)'], moving_avg, 
                color='red', linewidth=2, label=f'{window}-message Moving Average')
    
    plt.xlabel('Time (seconds)', fontsize=12)
    plt.ylabel('Latency (ms)', fontsize=12)
    plt.title(f'{name} - Latency Over Time', fontsize=14, fontweight='bold')
    plt.legend()
    plt.grid(True, alpha=0.3)
    
    plt.tight_layout()
    plt.savefig(filename, dpi=300)
    print(f"📁 Saved time series plot: {filename}")
    plt.close()

def plot_chat_distribution(df, name, filename):
    """Plot latency distribution by chat"""
    plt.figure(figsize=(12, 6))
    
    # Group by chat ID
    chat_groups = df.groupby('Chat ID')['Latency (ms)']
    
    # Create box plot
    chat_ids = []
    latencies_by_chat = []
    
    for chat_id, latencies in chat_groups:
        chat_ids.append(str(chat_id))
        latencies_by_chat.append(latencies.values)
    
    plt.boxplot(latencies_by_chat, labels=chat_ids, patch_artist=True,
                boxprops=dict(facecolor='lightblue', alpha=0.7),
                medianprops=dict(color='red', linewidth=2))
    
    plt.xlabel('Chat ID', fontsize=12)
    plt.ylabel('Latency (ms)', fontsize=12)
    plt.title(f'{name} - Latency Distribution by Chat', fontsize=14, fontweight='bold')
    plt.grid(True, alpha=0.3, axis='y')
    plt.xticks(rotation=45)
    
    plt.tight_layout()
    plt.savefig(filename, dpi=300)
    print(f"📁 Saved chat distribution: {filename}")
    plt.close()

def main():
    if len(sys.argv) < 2:
        print("Usage: python analyze-latency.py <a2p-csv-file> [p2p-csv-file]")
        print("\nExample:")
        print("  python analyze-latency.py a2p-latency-1234567890.csv p2p-latency-1234567890.csv")
        sys.exit(1)
    
    print("╔════════════════════════════════════════════════════════════════════╗")
    print("║         Latency Analysis Tool                                     ║")
    print("╚════════════════════════════════════════════════════════════════════╝\n")
    
    # Load A2P data
    a2p_file = sys.argv[1]
    a2p_df = load_latency_data(a2p_file)
    
    if a2p_df is None:
        sys.exit(1)
    
    print_statistics(a2p_df, "A2P (HTTP)")
    plot_histogram(a2p_df, "A2P (HTTP)", "a2p_histogram.png", color='blue')
    plot_time_series(a2p_df, "A2P (HTTP)", "a2p_timeseries.png", color='blue')
    
    if 'Chat ID' in a2p_df.columns:
        plot_chat_distribution(a2p_df, "A2P (HTTP)", "a2p_chat_distribution.png")
    
    # Load P2P data if provided
    if len(sys.argv) > 2:
        p2p_file = sys.argv[2]
        p2p_df = load_latency_data(p2p_file)
        
        if p2p_df is not None:
            print_statistics(p2p_df, "P2P (WebSocket)")
            plot_histogram(p2p_df, "P2P (WebSocket)", "p2p_histogram.png", color='orange')
            plot_time_series(p2p_df, "P2P (WebSocket)", "p2p_timeseries.png", color='orange')
            
            if 'Chat ID' in p2p_df.columns:
                plot_chat_distribution(p2p_df, "P2P (WebSocket)", "p2p_chat_distribution.png")
            
            # Comparison
            print("\n" + "="*70)
            print("🔬 Comparison Analysis")
            print("="*70)
            
            a2p_mean = a2p_df['Latency (ms)'].mean()
            p2p_mean = p2p_df['Latency (ms)'].mean()
            
            difference = abs(a2p_mean - p2p_mean)
            percentage = (difference / max(a2p_mean, p2p_mean)) * 100
            
            if a2p_mean < p2p_mean:
                print(f"🏆 A2P is faster by {difference:.2f}ms ({percentage:.1f}%)")
            else:
                print(f"🏆 P2P is faster by {difference:.2f}ms ({percentage:.1f}%)")
            
            plot_comparison(a2p_df, p2p_df, "comparison.png")
    
    print("\n" + "="*70)
    print("✅ Analysis complete!")
    print("="*70 + "\n")

if __name__ == "__main__":
    main()
