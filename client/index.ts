// client/index.ts
import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, web3 } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Connection, Keypair } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { SolanaInsuranceProtocol } from "../target/types/solana_insurance_protocol";
import idl from "../target/idl/solana_insurance_protocol.json";
import bs58 from 'bs58';

export class InsuranceProtocolClient {
  private program: Program<SolanaInsuranceProtocol>;
  private provider: AnchorProvider;
  private programId: PublicKey;
  
  constructor(
    connection: Connection,
    wallet: anchor.Wallet,
    programId: PublicKey = new PublicKey(idl.metadata.address)
  ) {
    this.provider = new AnchorProvider(
      connection,
      wallet,
      AnchorProvider.defaultOptions()
    );
    this.programId = programId;
    this.program = new Program(
      idl as any,
      this.programId,
      this.provider
    ) as Program<SolanaInsuranceProtocol>;
  }
  
  static getProgramAddress(address: string): PublicKey {
    return new PublicKey(address);
  }
  
  static createKeypair(): Keypair {
    return Keypair.generate();
  }
  
  async getProtocolStatePda(): Promise<[PublicKey, number]> {
    return await PublicKey.findProgramAddress(
      [Buffer.from("protocol-state")],
      this.programId
    );
  }
  
  async getProtocolRegistryPda(): Promise<[PublicKey, number]> {
    return await PublicKey.findProgramAddress(
      [Buffer.from("protocol-registry")],
      this.programId
    );
  }
  
  async getProtocolInfoPda(authority: PublicKey): Promise<[PublicKey, number]> {
    return await PublicKey.findProgramAddress(
      [Buffer.from("protocol-info"), authority.toBuffer()],
      this.programId
    );
  }
  
  async getCapitalPoolPda(poolType: number): Promise<[PublicKey, number]> {
    return await PublicKey.findProgramAddress(
      [Buffer.from("capital-pool"), Buffer.from([poolType])],
      this.programId
    );
  }
  
  async getPolicyPda(insured: PublicKey, protocolInfo: PublicKey): Promise<[PublicKey, number]> {
    return await PublicKey.findProgramAddress(
      [Buffer.from("policy"), insured.toBuffer(), protocolInfo.toBuffer()],
      this.programId
    );
  }
  
  async getClaimPda(policy: PublicKey): Promise<[PublicKey, number]> {
    return await PublicKey.findProgramAddress(
      [Buffer.from("claim"), policy.toBuffer()],
      this.programId
    );
  }
  
  async getCapitalProviderPda(owner: PublicKey, capitalPool: PublicKey): Promise<[PublicKey, number]> {
    return await PublicKey.findProgramAddress(
      [Buffer.from("capital-provider"), owner.toBuffer(), capitalPool.toBuffer()],
      this.programId
    );
  }
  
  async initializeProtocol(
    authority: Keypair,
    protocolFee: number // basis points
  ): Promise<string> {
    const [protocolStatePda] = await this.getProtocolStatePda();
    const [registryPda] = await this.getProtocolRegistryPda();
    
    const tx = await this.program.methods
      .initialize(new anchor.BN(protocolFee))
      .accounts({
        authority: authority.publicKey,
        protocolState: protocolStatePda,
        registry: registryPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    
    return tx;
  }
  
  async registerProtocol(
    authority: Keypair,
    protocolName: string,
    tvlUsd: number
  ): Promise<string> {
    const [protocolInfoPda] = await this.getProtocolInfoPda(authority.publicKey);
    const [registryPda] = await this.getProtocolRegistryPda();
    
    const tx = await this.program.methods
      .registerProtocol(protocolName, new anchor.BN(tvlUsd))
      .accounts({
        authority: authority.publicKey,
        protocolInfo: protocolInfoPda,
        registry: registryPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    
    return tx;
  }
  
  async createPolicy(
    insured: Keypair,
    protocolInfo: PublicKey,
    coverageAmount: number,
    premiumAmount: number,
    durationDays: number,
    insuredToken: PublicKey,
    treasuryToken: PublicKey
  ): Promise<string> {
    const [policyPda] = await this.getPolicyPda(insured.publicKey, protocolInfo);
    
    const tx = await this.program.methods
      .createPolicy(
        new anchor.BN(coverageAmount),
        new anchor.BN(premiumAmount),
        durationDays
      )
      .accounts({
        insured: insured.publicKey,
        policy: policyPda,
        protocolInfo,
        insuredToken,
        treasuryToken,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([insured])
      .rpc();
    
    return tx;
  }
  
  async updateProtocolRisk(
    authority: Keypair,
    protocolInfo: PublicKey,
    codeRiskParams: {
      auditCount: number,
      bugBountySize: number,
      complexityScore: number
    },
    economicRiskParams: {
      liquidityDepth: number,
      concentrationRisk: number
    },
    operationalRiskParams: {
      governanceCount: number,
      adminCount: number,
      oracleDependency: boolean
    }
  ): Promise<string> {
    const [protocolStatePda] = await this.getProtocolStatePda();
    
    const tx = await this.program.methods
      .updateProtocolRisk(
        {
          auditCount: codeRiskParams.auditCount,
          bugBountySize: new anchor.BN(codeRiskParams.bugBountySize),
          complexityScore: codeRiskParams.complexityScore,
        },
        {
          liquidityDepth: new anchor.BN(economicRiskParams.liquidityDepth),
          concentrationRisk: economicRiskParams.concentrationRisk,
        },
        {
          governanceCount: operationalRiskParams.governanceCount,
          adminCount: operationalRiskParams.adminCount,
          oracleDependency: operationalRiskParams.oracleDependency,
        }
      )
      .accounts({
        authority: authority.publicKey,
        protocolInfo,
        protocolState: protocolStatePda,
      })
      .signers([authority])
      .rpc();
    
    return tx;
  }
  
  async initializeCapitalPool(
    authority: Keypair,
    poolType: number,
    yieldRateBps: number,
    tokenMint: PublicKey,
    poolTokenAccount: PublicKey
  ): Promise<string> {
    const [protocolStatePda] = await this.getProtocolStatePda();
    const [capitalPoolPda] = await this.getCapitalPoolPda(poolType);
    
    const tx = await this.program.methods
      .initializeCapitalPool(poolType, new anchor.BN(yieldRateBps))
      .accounts({
        authority: authority.publicKey,
        capitalPool: capitalPoolPda,
        tokenMint,
        poolTokenAccount,
        protocolState: protocolStatePda,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([authority])
      .rpc();
    
    return tx;
  }
  
  async provideCapital(
    owner: Keypair,
    capitalPool: PublicKey,
    amount: number,
    providerToken: PublicKey,
    poolTokenAccount: PublicKey
  ): Promise<string> {
    const [capitalProviderPda] = await this.getCapitalProviderPda(owner.publicKey, capitalPool);
    
    const tx = await this.program.methods
      .provideCapital(new anchor.BN(amount))
      .accounts({
        owner: owner.publicKey,
        capitalProvider: capitalProviderPda,
        capitalPool,
        providerToken,
        poolTokenAccount,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([owner])
      .rpc();
    
    return tx;
  }
  
  async withdrawCapital(
    owner: Keypair,
    capitalPool: PublicKey,
    amount: number,
    providerToken: PublicKey,
    poolTokenAccount: PublicKey
  ): Promise<string> {
    const [capitalProviderPda] = await this.getCapitalProviderPda(owner.publicKey, capitalPool);
    
    const tx = await this.program.methods
      .withdrawCapital(new anchor.BN(amount))
      .accounts({
        owner: owner.publicKey,
        capitalProvider: capitalProviderPda,
        capitalPool,
        providerToken,
        poolTokenAccount,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([owner])
      .rpc();
    
    return tx;
  }
  
  async submitClaim(
    claimant: Keypair,
    policy: PublicKey,
    amount: number,
    evidence: string
  ): Promise<string> {
    const [claimPda] = await this.getClaimPda(policy);
    
    const tx = await this.program.methods
      .submitClaim(new anchor.BN(amount), evidence)
      .accounts({
        claimant: claimant.publicKey,
        policy,
        claim: claimPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([claimant])
      .rpc();
    
    return tx;
  }
  
  async resolveClaim(
    resolver: Keypair,
    claim: PublicKey,
    policy: PublicKey,
    protocolInfo: PublicKey,
    capitalPool: PublicKey,
    poolTokenAccount: PublicKey,
    claimantToken: PublicKey,
    approve: boolean,
    resolutionNotes: string
  ): Promise<string> {
    const tx = await this.program.methods
      .resolveClaim(approve, resolutionNotes)
      .accounts({
        resolver: resolver.publicKey,
        claim,
        policy,
        protocolInfo,
        capitalPool,
        poolTokenAccount,
        claimantToken,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([resolver])
      .rpc();
    
    return tx;
  }
  
  async createExploitAlert(
    authority: Keypair,
    protocolInfo: PublicKey,
    anomalyType: number,
    severity: number,
    details: string
  ): Promise<string> {
    const [protocolStatePda] = await this.getProtocolStatePda();
    
    // Create a timestamp-based seed for the exploit alert PDA
    const timestamp = new anchor.BN(Date.now());
    const timestampBuffer = Buffer.from(timestamp.toArray("le", 8));
    
    const [exploitAlertPda] = await PublicKey.findProgramAddress(
      [Buffer.from("exploit-alert"), protocolInfo.toBuffer(), timestampBuffer],
      this.programId
    );
    
    const tx = await this.program.methods
      .createExploitAlert(anomalyType, severity, details)
      .accounts({
        authority: authority.publicKey,
        exploitAlert: exploitAlertPda,
        protocolInfo,
        protocolState: protocolStatePda,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    
    return tx;
  }
  
  // Helper methods to retrieve account data
  
  async getProtocolState(): Promise<any> {
    const [protocolStatePda] = await this.getProtocolStatePda();
    return await this.program.account.protocolState.fetch(protocolStatePda);
  }
  
  async getProtocolRegistry(): Promise<any> {
    const [registryPda] = await this.getProtocolRegistryPda();
    return await this.program.account.protocolRegistry.fetch(registryPda);
  }
  
  async getProtocolInfo(authority: PublicKey): Promise<any> {
    const [protocolInfoPda] = await this.getProtocolInfoPda(authority);
    return await this.program.account.protocolInfo.fetch(protocolInfoPda);
  }
  
  async getPolicy(insured: PublicKey, protocolInfo: PublicKey): Promise<any> {
    const [policyPda] = await this.getPolicyPda(insured, protocolInfo);
    return await this.program.account.policy.fetch(policyPda);
  }
  
  async getClaim(policy: PublicKey): Promise<any> {
    const [claimPda] = await this.getClaimPda(policy);
    return await this.program.account.claim.fetch(claimPda);
  }
  
  async getCapitalPool(poolType: number): Promise<any> {
    const [capitalPoolPda] = await this.getCapitalPoolPda(poolType);
    return await this.program.account.capitalPool.fetch(capitalPoolPda);
  }
  
  async getCapitalProvider(owner: PublicKey, capitalPool: PublicKey): Promise<any> {
    const [capitalProviderPda] = await this.getCapitalProviderPda(owner, capitalPool);
    return await this.program.account.capitalProvider.fetch(capitalProviderPda);
  }
  
  // Query methods to get all accounts of a specific type
  
  async getAllProtocols(): Promise<any[]> {
    return await this.program.account.protocolInfo.all();
  }
  
  async getAllPolicies(): Promise<any[]> {
    return await this.program.account.policy.all();
  }
  
  async getAllClaims(): Promise<any[]> {
    return await this.program.account.claim.all();
  }
  
  async getAllCapitalPools(): Promise<any[]> {
    return await this.program.account.capitalPool.all();
  }
  
  async getAllCapitalProviders(): Promise<any[]> {
    return await this.program.account.capitalProvider.all();
  }
  
  async getAllExploitAlerts(): Promise<any[]> {
    return await this.program.account.exploitAlert.all();
  }
  
  // Filtered queries
  
  async getPoliciesByInsured(insured: PublicKey): Promise<any[]> {
    return await this.program.account.policy.all([
      {
        memcmp: {
          offset: 8, // After the discriminator
          bytes: insured.toBase58(),
        },
      },
    ]);
  }
  
  async getPoliciesByProtocol(protocol: PublicKey): Promise<any[]> {
    return await this.program.account.policy.all([
      {
        memcmp: {
          offset: 8 + 32, // After the discriminator and insured pubkey
          bytes: protocol.toBase58(),
        },
      },
    ]);
  }
  
  async getClaimsByStatus(status: number): Promise<any[]> {
    return await this.program.account.claim.all([
      {
        memcmp: {
          offset: 8 + 32 + 32 + 8 + 100 + 8, // Position of status field
          bytes: bs58.encode([status]),
        },
      },
    ]);
  }
  
  async getActiveProtocols(): Promise<any[]> {
    return await this.program.account.protocolInfo.all([
      {
        memcmp: {
          offset: 8 + 32 + 36 + 8 + 1, // Position of is_active field
          bytes: bs58.encode([1]), // 1 = true
        },
      },
    ]);
  }
  
  // Calculate premium based on risk score, coverage amount, and duration
  calculatePremium(
    riskScore: number,
    coverageAmount: number,
    durationDays: number
  ): number {
    // Get premium rate in basis points based on risk score
    let premiumRateBps: number;
    
    if (riskScore <= 25) {
      premiumRateBps = 25; // 0.25% annual rate for low risk
    } else if (riskScore <= 50) {
      premiumRateBps = 50; // 0.5% annual rate for medium-low risk
    } else if (riskScore <= 75) {
      premiumRateBps = 100; // 1% annual rate for medium-high risk
    } else {
      premiumRateBps = 200; // 2% annual rate for high risk
    }
    
    // Calculate annual premium
    const annualPremium = (coverageAmount * premiumRateBps) / 10000;
    
    // Calculate daily premium
    const dailyPremium = annualPremium / 365;
    
    // Calculate premium for the requested duration
    const premium = dailyPremium * durationDays;
    
    return premium;
  }
}

// Export constants
export const POOL_TYPE_LOW_RISK = 1;
export const POOL_TYPE_MEDIUM_RISK = 2;
export const POOL_TYPE_HIGH_RISK = 3;

export const CLAIM_STATUS_PENDING = 0;
export const CLAIM_STATUS_APPROVED = 1;
export const CLAIM_STATUS_REJECTED = 2;

export const ANOMALY_TVL_DROP = 1;
export const ANOMALY_PRICE = 2;
export const ANOMALY_TX_VOLUME = 3;