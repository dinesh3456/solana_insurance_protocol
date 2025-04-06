// components/RiskScoreCard.tsx
import React, { useEffect, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { InsuranceProtocolClient } from '../../client';

interface RiskScoreCardProps {
  client: InsuranceProtocolClient;
  protocolAuthority: PublicKey;
}

export const RiskScoreCard: React.FC<RiskScoreCardProps> = ({ client, protocolAuthority }) => {
  const [protocolInfo, setProtocolInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchProtocolInfo = async () => {
      try {
        setLoading(true);
        const info = await client.getProtocolInfo(protocolAuthority);
        setProtocolInfo(info);
        setError(null);
      } catch (err) {
        setError('Failed to load protocol info');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchProtocolInfo();
  }, [client, protocolAuthority]);

  const getRiskCategory = (score: number) => {
    if (score <= 25) return 'Low Risk';
    if (score <= 50) return 'Medium-Low Risk';
    if (score <= 75) return 'Medium-High Risk';
    return 'High Risk';
  };

  const getRiskColor = (score: number) => {
    if (score <= 25) return 'bg-green-500';
    if (score <= 50) return 'bg-yellow-400';
    if (score <= 75) return 'bg-orange-500';
    return 'bg-red-500';
  };

  if (loading) {
    return (
      <div className="animate-pulse bg-gray-200 rounded-lg p-6 w-full max-w-md">
        <div className="h-4 bg-gray-300 rounded w-3/4 mb-4"></div>
        <div className="h-8 bg-gray-300 rounded w-1/2 mb-6"></div>
        <div className="h-4 bg-gray-300 rounded w-full mb-2"></div>
        <div className="h-4 bg-gray-300 rounded w-5/6"></div>
      </div>
    );
  }

  if (error || !protocolInfo) {
    return (
      <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative" role="alert">
        <strong className="font-bold">Error!</strong>
        <span className="block sm:inline"> {error || 'Unable to load protocol info'}</span>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-6 w-full max-w-md">
      <h2 className="text-xl font-semibold text-gray-800">{protocolInfo.protocolName}</h2>
      
      <div className="mt-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-600">Risk Score</span>
          <span className="text-sm font-semibold">{protocolInfo.riskScore}/100</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2.5">
          <div 
            className={`h-2.5 rounded-full ${getRiskColor(protocolInfo.riskScore)}`} 
            style={{ width: `${protocolInfo.riskScore}%` }}
          ></div>
        </div>
        <div className="mt-2 text-right">
          <span className="inline-block px-2 py-1 text-xs font-semibold text-white rounded-full ${getRiskColor(protocolInfo.riskScore)}">
            {getRiskCategory(protocolInfo.riskScore)}
          </span>
        </div>
      </div>
      
      <div className="mt-6 grid grid-cols-2 gap-4">
        <div>
          <span className="text-sm text-gray-500">TVL</span>
          <p className="font-medium">${new Intl.NumberFormat().format(protocolInfo.tvlUsd.toNumber())}</p>
        </div>
        <div>
          <span className="text-sm text-gray-500">Status</span>
          <p className="font-medium">
            {protocolInfo.isActive ? (
              <span className="text-green-600">Active</span>
            ) : (
              <span className="text-red-600">Inactive</span>
            )}
          </p>
        </div>
      </div>
      
      <div className="mt-6">
        <h3 className="text-sm font-medium text-gray-600 mb-2">Annual Premium Rate</h3>
        <div className="flex items-center space-x-2">
          <span className="text-lg font-bold">
            {protocolInfo.riskScore <= 25 
              ? '0.25%' 
              : protocolInfo.riskScore <= 50 
                ? '0.5%' 
                : protocolInfo.riskScore <= 75 
                  ? '1.0%' 
                  : '2.0%'}
          </span>
          <span className="text-sm text-gray-500">of coverage amount</span>
        </div>
      </div>
    </div>
  );
};