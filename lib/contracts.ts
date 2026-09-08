import { parseAbi, parseAbiItem } from 'viem';
export const REGISTRY = '0x5C3F18F06CC09CA1910767A34a20F771039E37C0' as const;
export const registryAbi = parseAbi(['function poolFactories() view returns (address[])']);
export const approval = parseAbiItem('event Approve(address indexed poolFactory, address indexed votingRewardsFactory, address indexed gaugeFactory)');
export const v2Created = parseAbiItem('event PoolCreated(address indexed token0, address indexed token1, bool indexed stable, address pool, uint256 count)');
export const clCreated = parseAbiItem('event PoolCreated(address indexed token0, address indexed token1, int24 indexed tickSpacing, address pool)');
export const v2Mint = parseAbiItem('event Mint(address indexed sender, uint256 amount0, uint256 amount1)');
export const clMint = parseAbiItem('event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)');
