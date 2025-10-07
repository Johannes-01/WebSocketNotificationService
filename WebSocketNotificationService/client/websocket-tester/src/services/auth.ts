import { CognitoUserPool, CognitoUser, AuthenticationDetails, CognitoUserSession, CognitoUserAttribute } from 'amazon-cognito-identity-js';

const poolData = {
  UserPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID!,
  ClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!,
};

const userPool = new CognitoUserPool(poolData);

export interface SignUpInput {
  email: string;
  password: string;
  attributes?: Record<string, string>;
}

export interface SignInInput {
  username: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  idToken: string;
  refreshToken: string;
}

export async function signUp({ email, password, attributes = {} }: SignUpInput): Promise<CognitoUser> {
  return new Promise((resolve, reject) => {
    const attributeList = Object.entries(attributes).map(
      ([key, value]) => new CognitoUserAttribute({ Name: key, Value: value })
    );

    userPool.signUp(email, password, attributeList, [], (err, result) => {
      if (err) return reject(err);
      if (!result) return reject(new Error('No result from signUp'));
      resolve(result.user);
    });
  });
}

export async function signIn({ username, password }: SignInInput): Promise<AuthTokens> {
  const authDetails = new AuthenticationDetails({
    Username: username,
    Password: password,
  });

  const userData = {
    Username: username,
    Pool: userPool,
  };

  const cognitoUser = new CognitoUser(userData);

  return new Promise((resolve, reject) => {
    cognitoUser.authenticateUser(authDetails, {
      onSuccess: (session: CognitoUserSession) => {
        resolve({
          accessToken: session.getAccessToken().getJwtToken(),
          idToken: session.getIdToken().getJwtToken(),
          refreshToken: session.getRefreshToken().getToken(),
        });
      },
      onFailure: (err) => {
        reject(err);
      },
    });
  });
}

export async function signOut(): Promise<void> {
  const cognitoUser = userPool.getCurrentUser();
  if (cognitoUser) {
    cognitoUser.signOut();
  }
}

export function getCurrentUser(): CognitoUser | null {
  return userPool.getCurrentUser();
}

export async function getSession(): Promise<CognitoUserSession> {
  const cognitoUser = userPool.getCurrentUser();
  
  if (!cognitoUser) {
    throw new Error('No current user');
  }

  return new Promise((resolve, reject) => {
    cognitoUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err) return reject(err);
      if (!session) return reject(new Error('No session'));
      resolve(session);
    });
  });
}

export async function confirmSignUp(username: string, code: string): Promise<void> {
  const userData = {
    Username: username,
    Pool: userPool,
  };

  const cognitoUser = new CognitoUser(userData);

  return new Promise((resolve, reject) => {
    cognitoUser.confirmRegistration(code, true, (err, result) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

export async function resendConfirmationCode(username: string): Promise<void> {
  const userData = {
    Username: username,
    Pool: userPool,
  };

  const cognitoUser = new CognitoUser(userData);

  return new Promise((resolve, reject) => {
    cognitoUser.resendConfirmationCode((err, result) => {
      if (err) return reject(err);
      resolve();
    });
  });
}